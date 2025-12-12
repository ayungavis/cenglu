import { createLogger, expressErrorMiddleware, expressMiddleware } from "cenglu";
import express from "express";
import { randomInt } from "node:crypto";

// Create logger
const logger = createLogger({
  service: "express-example",
  level: "debug",
  pretty: { enabled: true },
});

// Create Express app
const app = express();
app.use(express.json());

// Add logging middleware
app.use(
  expressMiddleware(logger, {
    ignorePaths: ["/health", "/ready"],
    logRequests: true,
    logResponses: true,
    includeQuery: true,
  })
);

// Routes
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/users", (req, res) => {
  req.logger?.info("Fetching users list");

  const users = [
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
  ];

  req.logger?.debug("Found users", { count: users.length });
  res.json(users);
});

app.get("/users/:id", (req, res) => {
  const { id } = req.params;
  req.logger?.info("Fetching user", { userId: id });

  if (id === "999") {
    req.logger?.warn("User not found", { userId: id });
    return res.status(404).json({ error: "User not found" });
  }

  res.json({ id, name: `User ${id}` });
});

app.post("/users", (req, res) => {
  req.logger?.info("Creating user", { email: req.body.email });

  const user = {
    id: randomInt(0, 1000),
    ...req.body,
  };

  req.logger?.info("User created", { userId: user.id });
  res.status(201).json(user);
});

app.get("/error", (req, res, next) => {
  req.logger?.warn("About to throw an error");
  next(new Error("Intentional error for testing"));
});

// Error handling middleware
app.use(expressErrorMiddleware(logger));

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info("Server started", { port: PORT });
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("Shutting down...");
  await logger.close();
  process.exit(0);
});
