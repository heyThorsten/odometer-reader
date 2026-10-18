import { networkInterfaces } from "node:os";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

const lanAddresses = Object.values(networkInterfaces())
  .flatMap((interfaces) => interfaces ?? [])
  .filter((address) => !address.internal && address.family === "IPv4")
  .map((address) => address.address);

export default defineConfig({
  base: "./",
  plugins: [
    basicSsl({
      domains: ["localhost", "127.0.0.1", ...lanAddresses],
    }),
  ],
  server: {
    host: "0.0.0.0",
  },
});
