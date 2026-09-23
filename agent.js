class Agent {
  constructor(options = {}) {
    this.name = options.name || 'Dispatch Agent';
    this.role = options.role || 'Project planning assistant';
    this.status = 'ready';
  }

  buildPlan(task) {
    const normalized = String(task || '').trim();
    const taskSummary = normalized || 'General project review';

    return [
      {
        title: 'Scope the request',
        description: `Review the task and confirm the expected outcome for: ${taskSummary}`,
      },
      {
        title: 'Inspect the project',
        description: 'Review relevant files, config, and deployment setup to identify risks and dependencies.',
      },
      {
        title: 'Validate the plan',
        description: 'Check whether the proposed changes are safe, minimal, and ready to execute.',
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
