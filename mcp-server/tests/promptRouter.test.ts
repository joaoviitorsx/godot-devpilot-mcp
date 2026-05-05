import { describe, expect, it } from "vitest";

import { routePrompt } from "../src/workflows/prompt/promptRouter";

describe("routePrompt — 6 modes × PT/EN", () => {
  describe("CREATE", () => {
    it("PT: detects 'crie um jogo'", () => {
      const r = routePrompt("Crie um jogo 2D top-down survivor com inimigos.");
      expect(r.mode).toBe("CREATE");
      expect(r.confidence).toBeGreaterThan(0.5);
      expect(r.requires_project_scan).toBe(false);
    });
    it("EN: detects 'create a game'", () => {
      const r = routePrompt("Create a game from scratch — top-down survivor.");
      expect(r.mode).toBe("CREATE");
    });
  });

  describe("CONTINUE", () => {
    it("PT: detects 'continue o projeto'", () => {
      const r = routePrompt("Continue o projeto atual e adicione um boss no minuto 3.");
      expect(r.mode).toBe("CONTINUE");
      expect(r.requires_project_scan).toBe(true);
    });
    it("EN: detects 'existing project'", () => {
      const r = routePrompt("Iterate on the existing project and tweak the upgrade system.");
      expect(r.mode).toBe("CONTINUE");
    });
  });

  describe("ADD_FEATURE", () => {
    it("PT: detects 'adicione inventário'", () => {
      const r = routePrompt("Adicione um sistema de inventário ao jogo.");
      expect(r.mode).toBe("ADD_FEATURE");
    });
    it("EN: detects 'add inventory'", () => {
      const r = routePrompt("Add an inventory system with save support.");
      expect(r.mode).toBe("ADD_FEATURE");
    });
  });

  describe("FIX_BUG", () => {
    it("PT: detects 'não funciona'", () => {
      const r = routePrompt("O botão Start do menu principal não funciona, corrija.");
      expect(r.mode).toBe("FIX_BUG");
    });
    it("EN: detects 'doesn't work'", () => {
      const r = routePrompt("The pause menu doesn't work — fix the broken signal.");
      expect(r.mode).toBe("FIX_BUG");
    });
  });

  describe("POLISH", () => {
    it("PT: detects 'melhore o game feel'", () => {
      const r = routePrompt("Melhore o game feel do combate e ajuste a câmera.");
      expect(r.mode).toBe("POLISH");
    });
    it("EN: detects 'polish'", () => {
      const r = routePrompt("Polish the camera feel and improve performance.");
      expect(r.mode).toBe("POLISH");
    });
  });

  describe("VALIDATE", () => {
    it("PT: detects 'valide o projeto'", () => {
      const r = routePrompt("Valide o projeto e gere um diagnóstico de saúde.");
      expect(r.mode).toBe("VALIDATE");
    });
    it("EN: detects 'project health'", () => {
      const r = routePrompt("Run a project health audit and produce a release checklist.");
      expect(r.mode).toBe("VALIDATE");
    });
  });

  it("falls back to ADD_FEATURE on unknown prompt", () => {
    const r = routePrompt("xyzzy random words here");
    expect(r.mode).toBe("ADD_FEATURE");
    expect(r.confidence).toBeLessThan(0.5);
  });
});
