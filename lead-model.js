const sigmoid = (value) => 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, value))));

class LeadModel {
  constructor() {
    this.inputToHidden = [
      [1.2, -0.4, 0.3, 0.1],
      [-0.6, 0.8, 0.2, -0.1],
    ];
    this.hiddenBias = [0.1, -0.1, 0.05, 0];
    this.hiddenToOutput = [1.1, 0.7, 0.3, -0.2];
    this.outputBias = -0.35;
  }

  predict(features) {
    const hidden = this.hiddenBias.map((bias, hiddenIndex) => sigmoid(
      bias + features.reduce((sum, feature, inputIndex) => sum + feature * this.inputToHidden[inputIndex][hiddenIndex], 0),
    ));
    const probability = sigmoid(this.outputBias + hidden.reduce((sum, value, index) => sum + value * this.hiddenToOutput[index], 0));
    return { probability, score: Math.round(probability * 100) };
  }

  train(samples, { epochs = 20, learningRate = 0.05 } = {}) {
    if (!Array.isArray(samples) || samples.length === 0) return { trained: false, samples: 0 };
    const boundedEpochs = Math.max(1, Math.min(100, Number(epochs) || 20));
    const boundedRate = Math.max(0.001, Math.min(0.2, Number(learningRate) || 0.05));

    for (let epoch = 0; epoch < boundedEpochs; epoch += 1) {
      for (const sample of samples) {
        if (!Array.isArray(sample.features) || sample.features.length !== 2 || ![0, 1].includes(sample.label)) continue;
        const hidden = this.hiddenBias.map((bias, hiddenIndex) => sigmoid(
          bias + sample.features.reduce((sum, feature, inputIndex) => sum + feature * this.inputToHidden[inputIndex][hiddenIndex], 0),
        ));
        const output = sigmoid(this.outputBias + hidden.reduce((sum, value, index) => sum + value * this.hiddenToOutput[index], 0));
        const outputDelta = (output - sample.label) * output * (1 - output);
        const hiddenDeltas = hidden.map((value, index) => outputDelta * this.hiddenToOutput[index] * value * (1 - value));

        for (let index = 0; index < this.hiddenToOutput.length; index += 1) this.hiddenToOutput[index] -= boundedRate * outputDelta * hidden[index];
        this.outputBias -= boundedRate * outputDelta;
        for (let inputIndex = 0; inputIndex < this.inputToHidden.length; inputIndex += 1) {
          for (let hiddenIndex = 0; hiddenIndex < this.inputToHidden[inputIndex].length; hiddenIndex += 1) {
            this.inputToHidden[inputIndex][hiddenIndex] -= boundedRate * hiddenDeltas[hiddenIndex] * sample.features[inputIndex];
          }
        }
        for (let index = 0; index < this.hiddenBias.length; index += 1) this.hiddenBias[index] -= boundedRate * hiddenDeltas[index];
      }
    }
    return { trained: true, samples: samples.length, epochs: boundedEpochs };
  }
}

const model = new LeadModel();

function leadFeatures(lead) {
  return [
    lead.companySizeGuess === 'enterprise' ? 1 : 0,
    lead.intent === 'high' || lead.urgency === 'high' ? 1 : 0,
  ];
}

function scoreLead(lead) {
  return model.predict(leadFeatures(lead));
}

module.exports = { LeadModel, leadFeatures, scoreLead, model };
