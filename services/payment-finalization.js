function createSingleFlight() {
  const inFlight = new Map();

  return function runOnce(key, operation) {
    const active = inFlight.get(key);
    if (active) return active;

    const pending = Promise.resolve().then(operation);
    inFlight.set(key, pending);

    const clear = () => {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    };
    pending.then(clear, clear);

    return pending;
  };
}

module.exports = { createSingleFlight };
