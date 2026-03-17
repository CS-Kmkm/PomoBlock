export type FolderDropTarget = {
  dropzone: HTMLElement;
  folderId: string;
  beforeModuleId: string;
};

export function clearFolderDropIndicators(appRoot: HTMLElement): void {
  appRoot.querySelectorAll(".rs-folder-dropzone.is-over").forEach((node) => {
    node.classList.remove("is-over", "is-insert-end");
  });
  appRoot.querySelectorAll(".rs-asset-card.is-insert-target").forEach((node) => {
    node.classList.remove("is-insert-target");
  });
}

function resolveFolderInsertTarget(
  dropzone: HTMLElement,
  clientY: number,
  draggedModuleId: string,
): { beforeModuleId: string; insertTarget: HTMLElement | null } {
  const cards = Array.from(dropzone.querySelectorAll<HTMLElement>("[data-studio-asset-kind='module'][data-studio-asset-id]")).filter(
    (card) => !card.hidden && (card.dataset.studioAssetId || "") !== draggedModuleId,
  );
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (clientY <= rect.top + rect.height / 2) {
      return {
        beforeModuleId: card.dataset.studioAssetId || "",
        insertTarget: card,
      };
    }
  }
  return { beforeModuleId: "", insertTarget: null };
}

function paintFolderDropIndicator(appRoot: HTMLElement, dropzone: HTMLElement, insertTarget: HTMLElement | null): void {
  clearFolderDropIndicators(appRoot);
  dropzone.classList.add("is-over");
  if (insertTarget) {
    insertTarget.classList.add("is-insert-target");
    return;
  }
  dropzone.classList.add("is-insert-end");
}

export function resolveActiveFolderDrop(params: {
  appRoot: HTMLElement;
  clientX: number;
  clientY: number;
  draggedModuleId: string;
}): FolderDropTarget | null {
  const { appRoot, clientX, clientY, draggedModuleId } = params;
  const pointed = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  const dropzone = pointed?.closest("[data-studio-folder-dropzone]") as HTMLElement | null;
  if (!dropzone) {
    clearFolderDropIndicators(appRoot);
    return null;
  }
  const folderId = dropzone.dataset.studioFolderDropzone || "";
  if (!folderId) {
    clearFolderDropIndicators(appRoot);
    return null;
  }
  const { beforeModuleId, insertTarget } = resolveFolderInsertTarget(dropzone, clientY, draggedModuleId);
  paintFolderDropIndicator(appRoot, dropzone, insertTarget);
  return {
    dropzone,
    folderId,
    beforeModuleId,
  };
}
