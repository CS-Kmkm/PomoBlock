export type FolderDropTarget = {
  dropzone: HTMLElement;
  folderId: string;
  beforeModuleId: string;
  beforeTemplateId: string;
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
  draggedAssetId: string,
  draggedAssetKind: "module" | "template",
): { beforeModuleId: string; beforeTemplateId: string; insertTarget: HTMLElement | null } {
  const cards = Array.from(
    dropzone.querySelectorAll<HTMLElement>(`[data-studio-asset-kind='${draggedAssetKind}'][data-studio-asset-id]`),
  ).filter(
    (card) => !card.hidden && (card.dataset.studioAssetId || "") !== draggedAssetId,
  );
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (clientY <= rect.top + rect.height / 2) {
      return {
        beforeModuleId: draggedAssetKind === "module" ? card.dataset.studioAssetId || "" : "",
        beforeTemplateId: draggedAssetKind === "template" ? card.dataset.studioAssetId || "" : "",
        insertTarget: card,
      };
    }
  }
  return { beforeModuleId: "", beforeTemplateId: "", insertTarget: null };
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
  draggedAssetId: string;
  draggedAssetKind: "module" | "template";
}): FolderDropTarget | null {
  const { appRoot, clientX, clientY, draggedAssetId, draggedAssetKind } = params;
  const pointed = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  const folderGroup = pointed?.closest("[data-studio-folder-id]") as HTMLElement | null;
  if (!folderGroup) {
    clearFolderDropIndicators(appRoot);
    return null;
  }
  const dropzone = folderGroup.querySelector<HTMLElement>("[data-studio-folder-dropzone]");
  if (!dropzone) {
    clearFolderDropIndicators(appRoot);
    return null;
  }
  const folderId = dropzone.dataset.studioFolderDropzone || "";
  if (!folderId) {
    clearFolderDropIndicators(appRoot);
    return null;
  }
  const { beforeModuleId, beforeTemplateId, insertTarget } = resolveFolderInsertTarget(
    dropzone,
    clientY,
    draggedAssetId,
    draggedAssetKind,
  );
  paintFolderDropIndicator(appRoot, dropzone, insertTarget);
  return {
    dropzone,
    folderId,
    beforeModuleId,
    beforeTemplateId,
  };
}
