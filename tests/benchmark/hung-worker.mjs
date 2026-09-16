// A worker that never responds to cooperative abort, for hard-deadline testing.
process.on("message", () => {});
setInterval(() => {}, 1000);
