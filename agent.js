class Agent {
  constructor(options = {}) {
    this.name = options.name || 'Dispatch Agent';
    this.role = options.role || 'Project planning assistant';
    this.status = 'ready';
  }

  buildPlan(task) {
    return [
      {
        title: 'Scope the request',
        description: 'Define the outcome, constraints, and acceptance checks.',
      },
      {
        title: 'Inspect the project',
        description: 'Inspect relevant code, dependencies, and trust boundaries.',
      },
      {
        title: 'Implement and verify',
        description: 'Make the smallest safe change, run focused checks, and report blockers.',
      },
    ];
  }

  handleRequest(task) {
    const summary = String(task || '').trim() || 'General project review';
    const steps = this.buildPlan(task);

    return {
      name: this.name,
      role: this.role,
      status: this.status,
      summary: summary,
      steps,
    };
  }
}

module.exports = { Agent };
