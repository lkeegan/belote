import { afterEach, expect, it, vi } from "vitest";
import { recognizeFrench, localFrenchAvailability, installLocalFrench } from "./browser";

afterEach(() => vi.unstubAllGlobals());

it("does not silently fall back to remote recognition for local-only mode", async () => {
  const start = vi.fn();
  vi.stubGlobal("SpeechRecognition", class { start = start; });
  expect(() => recognizeFrench({ result: vi.fn(), error: vi.fn(), end: vi.fn() }, true))
    .toThrow("locale indisponible");
  expect(start).not.toHaveBeenCalled();
  expect(await localFrenchAvailability()).toBe("unsupported");
  expect(await installLocalFrench()).toBe(false);
});

it("probes and installs the French language pack explicitly", async () => {
  const available = vi.fn().mockResolvedValue("downloadable");
  const install = vi.fn().mockResolvedValue(true);
  vi.stubGlobal("SpeechRecognition", class {
    static available = available;
    static install = install;
  });
  expect(await localFrenchAvailability()).toBe("downloadable");
  expect(available).toHaveBeenCalledWith({ langs: ["fr-FR"], processLocally: true });
  expect(await installLocalFrench()).toBe(true);
  expect(install).toHaveBeenCalledWith({ langs: ["fr-FR"], processLocally: true });
});
