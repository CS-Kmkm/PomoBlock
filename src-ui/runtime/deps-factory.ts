import type { PageRenderDeps } from "../types.js";

export interface RuntimePageRenderers {
  renderTodayPage: (deps: PageRenderDeps) => void;
  renderDetailsPage: (deps: PageRenderDeps) => void;
  renderNowPage: (deps: PageRenderDeps) => void;
  renderRoutinesPage: (deps: PageRenderDeps) => void;
  renderInsightsPage: (deps: PageRenderDeps) => void;
  renderSettingsPage: (deps: PageRenderDeps) => void;
  renderBlocksPage: (deps: PageRenderDeps) => void;
}

export interface CreatePageRenderDepsFactoryOptions {
  baseDeps: Omit<PageRenderDeps, "renderers">;
  pageRenderers: RuntimePageRenderers;
}

export function createPageRenderDepsFactory(options: CreatePageRenderDepsFactoryOptions): () => PageRenderDeps {
  const { baseDeps, pageRenderers } = options;
  const build = (): PageRenderDeps => ({
    ...baseDeps,
    renderers: {
      renderDashboard: () => pageRenderers.renderTodayPage(build()),
      renderTodayDetailsPage: () => pageRenderers.renderDetailsPage(build()),
      renderPomodoro: () => pageRenderers.renderNowPage(build()),
      renderRoutines: () => pageRenderers.renderRoutinesPage(build()),
      renderReflection: () => pageRenderers.renderInsightsPage(build()),
      renderSettings: () => pageRenderers.renderSettingsPage(build()),
      renderBlocks: () => pageRenderers.renderBlocksPage(build()),
    },
  });
  return build;
}

export function buildPageRenderDeps(options: CreatePageRenderDepsFactoryOptions): PageRenderDeps {
  return createPageRenderDepsFactory(options)();
}
