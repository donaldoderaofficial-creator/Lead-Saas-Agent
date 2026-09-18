'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { leadFeatures, model } = require('./lead-model');

const statePath = path.resolve(process.env.LEARNING_MODEL_PATH || './model-state.json');
let metadata = { trainedAt: null, samples: 0, epochs: 0, clusters: [] };

function loadState() {
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (model.importState(state.model)) metadata = state.metadata || metadata;
  } catch (_) {}
}

function saveState() {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ model: model.exportState(), metadata }, null, 2));
}

function labeledSamples(leads) {
  return leads.filter((lead) => ['won', 'lost'].includes(lead.followupStatus))
    .map((lead) => ({ features: leadFeatures(lead), label: lead.followupStatus === 'won' ? 1 : 0 }));
}

function trainDecisionTree(samples, depth = 0) {
  if (!samples.length || depth >= 2 || samples.every((sample) => sample.label === samples[0].label)) {
    return { prediction: samples.filter((sample) => sample.label === 1).length >= samples.length / 2 ? 1 : 0, samples: samples.length };
  }
  let best = null;
  for (let feature = 0; feature < 2; feature += 1) {
    const groups = [samples.filter((sample) => sample.features[feature] === 0), samples.filter((sample) => sample.features[feature] === 1)];
    if (!groups[0].length || !groups[1].length) continue;
    const impurity = groups.reduce((total, group) => {
      const positive = group.filter((sample) => sample.label === 1).length / group.length;
      return total + group.length * (1 - positive * positive - (1 - positive) * (1 - positive));
    }, 0);
    if (!best || impurity < best.impurity) best = { feature, impurity, groups };
  }
  if (!best) return { prediction: samples.filter((sample) => sample.label === 1).length >= samples.length / 2 ? 1 : 0, samples: samples.length };
  return { feature: best.feature, threshold: 0.5, left: trainDecisionTree(best.groups[0], depth + 1), right: trainDecisionTree(best.groups[1], depth + 1), samples: samples.length };
}

function clusterLeads(leads) {
  const points = leads.map((lead) => ({ lead, point: leadFeatures(lead) }));
  if (!points.length) return [];
  const centroids = [[0, 0], [1, 1]];
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const groups = [[], []];
    for (const item of points) {
      const distances = centroids.map((centroid) => item.point.reduce((sum, value, index) => sum + (value - centroid[index]) ** 2, 0));
      groups[distances[0] <= distances[1] ? 0 : 1].push(item.point);
    }
    groups.forEach((group, index) => {
      if (group.length) centroids[index] = centroids[index].map((_, feature) => group.reduce((sum, point) => sum + point[feature], 0) / group.length);
    });
  }
  return centroids.map((centroid, index) => ({ cluster: index, centroid, members: points.filter((item) => {
    const distances = centroids.map((candidate) => item.point.reduce((sum, value, feature) => sum + (value - candidate[feature]) ** 2, 0));
    return (distances[0] <= distances[1] ? 0 : 1) === index;
  }).length }));
}

function trainFromLeads(leads) {
  const samples = labeledSamples(leads);
  const result = model.train(samples, { epochs: 30, learningRate: 0.03 });
  const tree = trainDecisionTree(samples);
  const clusters = clusterLeads(leads);
  metadata = { trainedAt: new Date().toISOString(), samples: samples.length, epochs: result.epochs || 0, decisionTree: tree, clusters };
  saveState();
  return { ...metadata, trained: result.trained };
}

function learningStatus() {
  return { statePath, ...metadata, modelLoaded: Boolean(metadata.trainedAt) };
}

loadState();

module.exports = { trainFromLeads, learningStatus };