const { createServer } = require("https");
const { parse } = require("url");
const next = require("next");
const fs = require("fs");
const path = require("path");

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3456", 10);

const httpsOptions = {
  key: fs.readFileSync(path.join(__dirname, "certs", "key.pem")),
  cert: fs.readFileSync(path.join(__dirname, "certs", "cert.pem")),
};

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(httpsOptions, async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error("Error occurred handling", req.url, err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  }).listen(port, hostname, () => {
    console.log(`> Ready on https://${hostname}:${port}`);
  });

  // Graceful shutdown: drain connections and disconnect Prisma
  let shuttingDown = false;
  function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`> ${signal} received — shutting down gracefully...`);

    server.close(async () => {
      console.log("> HTTP server closed");
      try {
        const { PrismaClient } = require("@prisma/client");
        // Import the shared prisma instance if available, otherwise create one to clean up
        let prisma;
        try {
          prisma = require("./src/lib/prisma").default;
        } catch {
          prisma = new PrismaClient();
        }
        await prisma.$disconnect();
        console.log("> Prisma disconnected");
      } catch (err) {
        console.error("> Error disconnecting Prisma:", err);
      }
      process.exit(0);
    });

    // Force exit after 30s if connections don't drain
    setTimeout(() => {
      console.error("> Forced shutdown after timeout");
      process.exit(1);
    }, 30_000);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
});
