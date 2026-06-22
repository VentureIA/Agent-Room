import { afterEach, describe, expect, it } from "vitest";
import { OFFICIAL_AGENTROOM_RELAY_URL, resolveDefaultRelayUrl } from "../src/core/remote.js";

describe("remote relay defaults", () => {
  const previousRelayUrl = process.env.AGENTROOM_RELAY_URL;
  const previousDefaultRelayUrl = process.env.AGENTROOM_DEFAULT_RELAY_URL;
  const previousNpmRelayUrl = process.env.npm_config_agentroom_relay_url;
  const previousNpmRelay = process.env.npm_config_agentroom_relay;

  afterEach(() => {
    restoreEnv("AGENTROOM_RELAY_URL", previousRelayUrl);
    restoreEnv("AGENTROOM_DEFAULT_RELAY_URL", previousDefaultRelayUrl);
    restoreEnv("npm_config_agentroom_relay_url", previousNpmRelayUrl);
    restoreEnv("npm_config_agentroom_relay", previousNpmRelay);
  });

  it("uses AgentRoom hosted relay when no custom relay is configured", () => {
    delete process.env.AGENTROOM_RELAY_URL;
    delete process.env.AGENTROOM_DEFAULT_RELAY_URL;
    delete process.env.npm_config_agentroom_relay_url;
    delete process.env.npm_config_agentroom_relay;

    expect(resolveDefaultRelayUrl()).toBe(OFFICIAL_AGENTROOM_RELAY_URL);
  });

  it("lets custom relay configuration override the hosted default", () => {
    process.env.AGENTROOM_RELAY_URL = "https://relay.example.com/";

    expect(resolveDefaultRelayUrl()).toBe("https://relay.example.com");
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
