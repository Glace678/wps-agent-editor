// SuperDoc 1.44 measures image resize drags with getBoundingClientRect(), but
// the presentation editor applies page zoom with a transform. That mixes
// visual pixels with the unscaled image dimensions stored in the document.
// It also chooses Math.max(scaleX, scaleY), so an inward drag on one axis is
// cancelled by the unchanged axis and cannot shrink the image.
//
// Keep the document dimensions in layout pixels, convert pointer movement back
// through the active visual scale, and project the drag onto the image diagonal.
// The package is pinned to 1.44.0; fail loudly if its generated output changes.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(root, 'node_modules', 'superdoc', 'dist')

function apply(file, replacements) {
  const target = path.join(distDir, file)
  const source = readFileSync(target, 'utf8')
  let output = source

  for (const { from, to, label, already = to } of replacements) {
    if (output.includes(already)) {
      console.log(`[SKIP] ${file}: ${label} (already applied)`)
      continue
    }

    const count = output.split(from).length - 1
    if (count !== 1) {
      throw new Error(`${file}: ${label}: expected exactly 1 source occurrence, found ${count}`)
    }

    output = output.replace(from, to)
    console.log(`[OK]   ${file}: ${label}`)
  }

  if (output !== source) writeFileSync(target, output, 'utf8')
}

const chunkReplacements = [
  {
    label: 'render the resize guideline in visual pixels',
    from: `\t\t\t\twidth: \`\${dragState.value.constrainedWidth}px\`,\n\t\t\t\theight: \`\${dragState.value.constrainedHeight}px\`,`,
    to: `\t\t\t\twidth: \`\${dragState.value.constrainedWidth * dragState.value.visualScaleX}px\`,\n\t\t\t\theight: \`\${dragState.value.constrainedHeight * dragState.value.visualScaleY}px\`,`,
  },
  {
    label: 'capture unscaled image dimensions and the active visual scale',
    from: `\t\t\tconst rect = props.imageElement.getBoundingClientRect();\n\t\t\tdragState.value = {\n\t\t\t\thandle: handlePosition,\n\t\t\t\tinitialX: event.clientX,\n\t\t\t\tinitialY: event.clientY,\n\t\t\t\tinitialWidth: rect.width,\n\t\t\t\tinitialHeight: rect.height,\n\t\t\t\taspectRatio: imageMetadata.value.aspectRatio,\n\t\t\t\tconstrainedWidth: rect.width,\n\t\t\t\tconstrainedHeight: rect.height\n\t\t\t};`,
    to: `\t\t\tconst rect = props.imageElement.getBoundingClientRect();\n\t\t\tconst layoutWidth = props.imageElement.offsetWidth || rect.width;\n\t\t\tconst layoutHeight = props.imageElement.offsetHeight || rect.height;\n\t\t\tconst visualScaleX = rect.width / layoutWidth || 1;\n\t\t\tconst visualScaleY = rect.height / layoutHeight || 1;\n\t\t\tdragState.value = {\n\t\t\t\thandle: handlePosition,\n\t\t\t\tinitialX: event.clientX,\n\t\t\t\tinitialY: event.clientY,\n\t\t\t\tinitialWidth: layoutWidth,\n\t\t\t\tinitialHeight: layoutHeight,\n\t\t\t\taspectRatio: imageMetadata.value.aspectRatio,\n\t\t\t\tvisualScaleX,\n\t\t\t\tvisualScaleY,\n\t\t\t\tconstrainedWidth: layoutWidth,\n\t\t\t\tconstrainedHeight: layoutHeight\n\t\t\t};`,
  },
  {
    label: 'report unscaled initial dimensions',
    from: `\t\t\temit("resize-start", {\n\t\t\t\tblockId: props.imageElement.getAttribute("data-sd-block-id"),\n\t\t\t\tinitialWidth: rect.width,\n\t\t\t\tinitialHeight: rect.height\n\t\t\t});`,
    to: `\t\t\temit("resize-start", {\n\t\t\t\tblockId: props.imageElement.getAttribute("data-sd-block-id"),\n\t\t\t\tinitialWidth: layoutWidth,\n\t\t\t\tinitialHeight: layoutHeight\n\t\t\t});`,
  },
  {
    label: 'project scaled pointer movement onto the image diagonal',
    from: `\t\t\tlet deltaX = event.clientX - dragState.value.initialX;\n\t\t\tlet deltaY = event.clientY - dragState.value.initialY;\n\t\t\tconst handle = dragState.value.handle;\n\t\t\tif (handle === "nw") {\n\t\t\t\tdeltaX = -deltaX;\n\t\t\t\tdeltaY = -deltaY;\n\t\t\t} else if (handle === "ne") deltaY = -deltaY;\n\t\t\telse if (handle === "sw") deltaX = -deltaX;\n\t\t\tconst scaleX = (dragState.value.initialWidth + deltaX) / dragState.value.initialWidth;\n\t\t\tconst scaleY = (dragState.value.initialHeight + deltaY) / dragState.value.initialHeight;\n\t\t\tconst scale = Math.max(scaleX, scaleY);\n\t\t\tlet newWidth = dragState.value.initialWidth * scale;\n\t\t\tlet newHeight = dragState.value.initialHeight * scale;`,
    to: `\t\t\tlet deltaX = (event.clientX - dragState.value.initialX) / dragState.value.visualScaleX;\n\t\t\tlet deltaY = (event.clientY - dragState.value.initialY) / dragState.value.visualScaleY;\n\t\t\tconst handle = dragState.value.handle;\n\t\t\tif (handle === "nw") {\n\t\t\t\tdeltaX = -deltaX;\n\t\t\t\tdeltaY = -deltaY;\n\t\t\t} else if (handle === "ne") deltaY = -deltaY;\n\t\t\telse if (handle === "sw") deltaX = -deltaX;\n\t\t\tconst initialWidth = dragState.value.initialWidth;\n\t\t\tconst initialHeight = dragState.value.initialHeight;\n\t\t\tconst diagonalSquared = initialWidth * initialWidth + initialHeight * initialHeight;\n\t\t\tconst scale = 1 + (initialWidth * deltaX + initialHeight * deltaY) / diagonalSquared;\n\t\t\tlet newWidth = initialWidth * scale;\n\t\t\tlet newHeight = initialHeight * scale;`,
  },
  {
    label: 'manage a transient live image preview during resize',
    from: `\t\tfunction readLockMode(element) {`,
    to: `\t\tlet liveImagePreview = null;\n\t\tfunction beginLiveImagePreview() {\n\t\t\tconst element = props.imageElement;\n\t\t\tif (!element) return;\n\t\t\tliveImagePreview = {\n\t\t\t\telement,\n\t\t\t\twidth: element.style.width,\n\t\t\t\theight: element.style.height\n\t\t\t};\n\t\t}\n\t\tfunction applyLiveImagePreview(width, height) {\n\t\t\tconst element = liveImagePreview?.element;\n\t\t\tif (!element?.isConnected) return;\n\t\t\telement.style.width = \`\${width}px\`;\n\t\t\telement.style.height = \`\${height}px\`;\n\t\t}\n\t\tfunction endLiveImagePreview(restore) {\n\t\t\tconst preview = liveImagePreview;\n\t\t\tif (!preview) return;\n\t\t\tif (restore) {\n\t\t\t\tpreview.element.style.width = preview.width;\n\t\t\t\tpreview.element.style.height = preview.height;\n\t\t\t}\n\t\t\tliveImagePreview = null;\n\t\t}\n\t\tfunction readLockMode(element) {`,
  },
  {
    label: 'start the live image preview with the drag',
    from: `\t\t\t\tconstrainedHeight: layoutHeight\n\t\t\t};\n\t\t\tconst pmView = editor.view.dom;`,
    to: `\t\t\t\tconstrainedHeight: layoutHeight\n\t\t\t};\n\t\t\tbeginLiveImagePreview();\n\t\t\tconst pmView = editor.view.dom;`,
  },
  {
    label: 'preview the image itself on every processed pointer move',
    from: `\t\tconst mouseMoveThrottle = throttle$1((event) => {\n\t\t\tif (!dragState.value || !imageMetadata.value) return;`,
    to: `\t\tconst updateResizeFromPointer = (event) => {\n\t\t\tif (!dragState.value || !imageMetadata.value) return;`,
  },
  {
    label: 'wire live preview into the throttled pointer handler',
    from: `\t\t\tdragState.value.constrainedWidth = newWidth;\n\t\t\tdragState.value.constrainedHeight = newHeight;\n\t\t\temit("resize-move", {\n\t\t\t\tblockId: props.imageElement.getAttribute("data-sd-block-id"),\n\t\t\t\twidth: newWidth,\n\t\t\t\theight: newHeight\n\t\t\t});\n\t\t}, MOUSE_MOVE_THROTTLE_MS);\n\t\tconst onDocumentMouseMove$1 = mouseMoveThrottle.throttled;`,
    to: `\t\t\tdragState.value.constrainedWidth = newWidth;\n\t\t\tdragState.value.constrainedHeight = newHeight;\n\t\t\tapplyLiveImagePreview(newWidth, newHeight);\n\t\t\temit("resize-move", {\n\t\t\t\tblockId: props.imageElement.getAttribute("data-sd-block-id"),\n\t\t\t\twidth: newWidth,\n\t\t\t\theight: newHeight\n\t\t\t});\n\t\t};\n\t\tconst mouseMoveThrottle = throttle$1(updateResizeFromPointer, MOUSE_MOVE_THROTTLE_MS);\n\t\tconst onDocumentMouseMove$1 = mouseMoveThrottle.throttled;`,
  },
  {
    label: 'flush final pointer position and restore cancelled previews',
    from: `\t\tfunction onDocumentMouseUp(event) {\n\t\t\tif (!dragState.value) return;\n\t\t\tconst finalWidth = dragState.value.constrainedWidth;\n\t\t\tconst finalHeight = dragState.value.constrainedHeight;\n\t\t\tconst blockId = props.imageElement?.getAttribute("data-sd-block-id");\n\t\t\tdocument.removeEventListener("mousemove", onDocumentMouseMove$1);\n\t\t\tdocument.removeEventListener("mouseup", onDocumentMouseUp);\n\t\t\tdocument.removeEventListener("keydown", onEscapeKey);\n\t\t\tconst editor = resizeEditor.value;\n\t\t\tif (editor?.view) {\n\t\t\t\tconst pmView = editor.view.dom;\n\t\t\t\tif (pmView && pmView.style) pmView.style.pointerEvents = "auto";\n\t\t\t}\n\t\t\tconst widthDelta = Math.abs(finalWidth - dragState.value.initialWidth);\n\t\t\tconst heightDelta = Math.abs(finalHeight - dragState.value.initialHeight);\n\t\t\tif (!forcedCleanup.value && (widthDelta > DIMENSION_CHANGE_THRESHOLD_PX$1 || heightDelta > DIMENSION_CHANGE_THRESHOLD_PX$1)) {\n\t\t\t\tdispatchResizeTransaction(blockId, finalWidth, finalHeight);\n\t\t\t\temit("resize-end", {\n\t\t\t\t\tblockId,\n\t\t\t\t\tfinalWidth,\n\t\t\t\t\tfinalHeight\n\t\t\t\t});\n\t\t\t}\n\t\t\tdragState.value = null;\n\t\t}`,
    to: `\t\tfunction onDocumentMouseUp(event) {\n\t\t\tif (!dragState.value) return;\n\t\t\tmouseMoveThrottle.cancel();\n\t\t\tif (!forcedCleanup.value && event instanceof MouseEvent) updateResizeFromPointer(event);\n\t\t\tconst finalWidth = dragState.value.constrainedWidth;\n\t\t\tconst finalHeight = dragState.value.constrainedHeight;\n\t\t\tconst blockId = props.imageElement?.getAttribute("data-sd-block-id");\n\t\t\tdocument.removeEventListener("mousemove", onDocumentMouseMove$1);\n\t\t\tdocument.removeEventListener("mouseup", onDocumentMouseUp);\n\t\t\tdocument.removeEventListener("keydown", onEscapeKey);\n\t\t\tconst editor = resizeEditor.value;\n\t\t\tif (editor?.view) {\n\t\t\t\tconst pmView = editor.view.dom;\n\t\t\t\tif (pmView && pmView.style) pmView.style.pointerEvents = "auto";\n\t\t\t}\n\t\t\tconst widthDelta = Math.abs(finalWidth - dragState.value.initialWidth);\n\t\t\tconst heightDelta = Math.abs(finalHeight - dragState.value.initialHeight);\n\t\t\tconst shouldCommit = !forcedCleanup.value && (widthDelta > DIMENSION_CHANGE_THRESHOLD_PX$1 || heightDelta > DIMENSION_CHANGE_THRESHOLD_PX$1);\n\t\t\tconst committed = shouldCommit && dispatchResizeTransaction(blockId, finalWidth, finalHeight);\n\t\t\tendLiveImagePreview(!committed);\n\t\t\tif (committed) emit("resize-end", {\n\t\t\t\tblockId,\n\t\t\t\tfinalWidth,\n\t\t\t\tfinalHeight\n\t\t\t});\n\t\t\tdragState.value = null;\n\t\t}`,
  },
  {
    label: 'report whether the final resize transaction committed',
    from: `\t\tfunction dispatchResizeTransaction(blockId, newWidth, newHeight) {\n\t\t\tconst editor = resizeEditor.value;\n\t\t\tif (!isValidEditor(editor) || !props.imageElement || isResizeDisabled.value) return;`,
    to: `\t\tfunction dispatchResizeTransaction(blockId, newWidth, newHeight) {\n\t\t\tconst editor = resizeEditor.value;\n\t\t\tif (!isValidEditor(editor) || !props.imageElement || isResizeDisabled.value) return false;`,
  },
  {
    label: 'return false for invalid final dimensions',
    from: `\t\t\t\temit("resize-error", {\n\t\t\t\t\tblockId,\n\t\t\t\t\terror: "Invalid dimensions: width and height must be positive finite numbers"\n\t\t\t\t});\n\t\t\t\treturn;`,
    to: `\t\t\t\temit("resize-error", {\n\t\t\t\t\tblockId,\n\t\t\t\t\terror: "Invalid dimensions: width and height must be positive finite numbers"\n\t\t\t\t});\n\t\t\t\treturn false;`,
  },
  {
    label: 'return false when the image marker is missing',
    from: `\t\t\t\t\temit("resize-error", {\n\t\t\t\t\t\tblockId,\n\t\t\t\t\t\terror: "Image position marker (data-pm-start) not found"\n\t\t\t\t\t});\n\t\t\t\t\treturn;`,
    to: `\t\t\t\t\temit("resize-error", {\n\t\t\t\t\t\tblockId,\n\t\t\t\t\t\terror: "Image position marker (data-pm-start) not found"\n\t\t\t\t\t});\n\t\t\t\t\treturn false;`,
  },
  {
    label: 'return false for an invalid image position',
    from: `\t\t\t\t\temit("resize-error", {\n\t\t\t\t\t\tblockId,\n\t\t\t\t\t\terror: "Invalid image position marker"\n\t\t\t\t\t});\n\t\t\t\t\treturn;`,
    to: `\t\t\t\t\temit("resize-error", {\n\t\t\t\t\t\tblockId,\n\t\t\t\t\t\terror: "Invalid image position marker"\n\t\t\t\t\t});\n\t\t\t\t\treturn false;`,
  },
  {
    label: 'return false when the image node cannot be resolved',
    from: `\t\t\t\t\temit("resize-error", {\n\t\t\t\t\t\tblockId,\n\t\t\t\t\t\terror: "Invalid image node at position"\n\t\t\t\t\t});\n\t\t\t\t\treturn;`,
    to: `\t\t\t\t\temit("resize-error", {\n\t\t\t\t\t\tblockId,\n\t\t\t\t\t\terror: "Invalid image node at position"\n\t\t\t\t\t});\n\t\t\t\t\treturn false;`,
  },
  {
    label: 'return the final transaction outcome',
    from: `\t\t\t\temit("resize-success", {\n\t\t\t\t\tblockId,\n\t\t\t\t\tnewWidth,\n\t\t\t\t\tnewHeight\n\t\t\t\t});\n\t\t\t} catch (error) {\n\t\t\t\temit("resize-error", {\n\t\t\t\t\tblockId,\n\t\t\t\t\terror: error instanceof Error ? error.message : String(error)\n\t\t\t\t});\n\t\t\t}\n\t\t}`,
    to: `\t\t\t\temit("resize-success", {\n\t\t\t\t\tblockId,\n\t\t\t\t\tnewWidth,\n\t\t\t\t\tnewHeight\n\t\t\t\t});\n\t\t\t\treturn true;\n\t\t\t} catch (error) {\n\t\t\t\temit("resize-error", {\n\t\t\t\t\tblockId,\n\t\t\t\t\terror: error instanceof Error ? error.message : String(error)\n\t\t\t\t});\n\t\t\t\treturn false;\n\t\t\t}\n\t\t}`,
  },
  {
    label: 'restore transient preview when the overlay unmounts',
    from: `\t\t\tmouseMoveThrottle.cancel();\n\t\t\tif (dragState.value) {\n\t\t\t\tdocument.removeEventListener("mousemove", onDocumentMouseMove$1);`,
    to: `\t\t\tmouseMoveThrottle.cancel();\n\t\t\tendLiveImagePreview(true);\n\t\t\tif (dragState.value) {\n\t\t\t\tdocument.removeEventListener("mousemove", onDocumentMouseMove$1);`,
  },
]

apply('chunks/src-CcBJnYZd.es.js', chunkReplacements)
apply('chunks/src-VzGe-_l_.cjs', chunkReplacements)

apply('superdoc.min.js', [
  {
    label: 'render the resize guideline in visual pixels',
    from: 'width:`${c.value.constrainedWidth}px`,height:`${c.value.constrainedHeight}px`',
    to: 'width:`${c.value.constrainedWidth*c.value.visualScaleX}px`,height:`${c.value.constrainedHeight*c.value.visualScaleY}px`',
  },
  {
    label: 'capture unscaled image dimensions and the active visual scale',
    from: 'function y(x,C){if(x.preventDefault(),x.stopPropagation(),a.value)return;const k=i.value;if(!n(k)||!l.value||!r.imageElement)return;const P=r.imageElement.getBoundingClientRect();c.value={handle:C,initialX:x.clientX,initialY:x.clientY,initialWidth:P.width,initialHeight:P.height,aspectRatio:l.value.aspectRatio,constrainedWidth:P.width,constrainedHeight:P.height};const E=k.view.dom;E.style.pointerEvents="none",document.addEventListener("mousemove",A),document.addEventListener("mouseup",w),document.addEventListener("keydown",S),o("resize-start",{blockId:r.imageElement.getAttribute("data-sd-block-id"),initialWidth:P.width,initialHeight:P.height})}',
    to: 'function y(x,C){if(x.preventDefault(),x.stopPropagation(),a.value)return;const k=i.value;if(!n(k)||!l.value||!r.imageElement)return;const P=r.imageElement.getBoundingClientRect(),M=r.imageElement.offsetWidth||P.width,O=r.imageElement.offsetHeight||P.height,H=P.width/M||1,W=P.height/O||1;c.value={handle:C,initialX:x.clientX,initialY:x.clientY,initialWidth:M,initialHeight:O,aspectRatio:l.value.aspectRatio,visualScaleX:H,visualScaleY:W,constrainedWidth:M,constrainedHeight:O};const E=k.view.dom;E.style.pointerEvents="none",document.addEventListener("mousemove",A),document.addEventListener("mouseup",w),document.addEventListener("keydown",S),o("resize-start",{blockId:r.imageElement.getAttribute("data-sd-block-id"),initialWidth:M,initialHeight:O})}',
    already: 'visualScaleX:H,visualScaleY:W,constrainedWidth:M,constrainedHeight:O},_beginImageResizePreview()',
  },
  {
    label: 'project scaled pointer movement onto the image diagonal',
    from: 'let C=x.clientX-c.value.initialX,k=x.clientY-c.value.initialY;const P=c.value.handle;P==="nw"?(C=-C,k=-k):P==="ne"?k=-k:P==="sw"&&(C=-C);const E=(c.value.initialWidth+C)/c.value.initialWidth,L=(c.value.initialHeight+k)/c.value.initialHeight,R=Math.max(E,L);let M=c.value.initialWidth*R,O=c.value.initialHeight*R;',
    to: 'let C=(x.clientX-c.value.initialX)/c.value.visualScaleX,k=(x.clientY-c.value.initialY)/c.value.visualScaleY;const P=c.value.handle;P==="nw"?(C=-C,k=-k):P==="ne"?k=-k:P==="sw"&&(C=-C);const E=c.value.initialWidth,L=c.value.initialHeight,R=1+(E*C+L*k)/(E*E+L*L);let M=E*R,O=L*R;',
  },
  {
    label: 'add transient live image preview helpers',
    from: 'l=Ne(null),c=Ne(null),u=Ne(!1);function d(x)',
    to: 'l=Ne(null),c=Ne(null),u=Ne(!1);let _imageResizePreview=null;function _beginImageResizePreview(){const x=r.imageElement;if(!x)return;_imageResizePreview={element:x,width:x.style.width,height:x.style.height}}function _applyImageResizePreview(x,C){const k=_imageResizePreview?.element;k?.isConnected&&(k.style.width=`${x}px`,k.style.height=`${C}px`)}function _endImageResizePreview(x){const C=_imageResizePreview;C&&(x&&(C.element.style.width=C.width,C.element.style.height=C.height),_imageResizePreview=null)}function d(x)',
  },
  {
    label: 'start live preview and name the pointer updater',
    from: 'constrainedWidth:M,constrainedHeight:O};const E=k.view.dom;',
    to: 'constrainedWidth:M,constrainedHeight:O},_beginImageResizePreview();const E=k.view.dom;',
  },
  {
    label: 'preview the image and preserve the final pointer position',
    from: 'const b=v(x=>{if(!c.value||!l.value)return;let C=(x.clientX-c.value.initialX)/c.value.visualScaleX,k=(x.clientY-c.value.initialY)/c.value.visualScaleY;const P=c.value.handle;P==="nw"?(C=-C,k=-k):P==="ne"?k=-k:P==="sw"&&(C=-C);const E=c.value.initialWidth,L=c.value.initialHeight,R=1+(E*C+L*k)/(E*E+L*L);let M=E*R,O=L*R;const H=l.value.minWidth,W=l.value.minHeight,G=l.value.maxWidth,U=l.value.maxHeight;M<H&&(M=H,O=M/c.value.aspectRatio),O<W&&(O=W,M=O*c.value.aspectRatio),M>G&&(M=G,O=M/c.value.aspectRatio),O>U&&(O=U,M=O*c.value.aspectRatio),c.value.constrainedWidth=M,c.value.constrainedHeight=O,o("resize-move",{blockId:r.imageElement.getAttribute("data-sd-block-id"),width:M,height:O})},Vlr),A=b.throttled;',
    to: 'const _updateImageResize=x=>{if(!c.value||!l.value)return;let C=(x.clientX-c.value.initialX)/c.value.visualScaleX,k=(x.clientY-c.value.initialY)/c.value.visualScaleY;const P=c.value.handle;P==="nw"?(C=-C,k=-k):P==="ne"?k=-k:P==="sw"&&(C=-C);const E=c.value.initialWidth,L=c.value.initialHeight,R=1+(E*C+L*k)/(E*E+L*L);let M=E*R,O=L*R;const H=l.value.minWidth,W=l.value.minHeight,G=l.value.maxWidth,U=l.value.maxHeight;M<H&&(M=H,O=M/c.value.aspectRatio),O<W&&(O=W,M=O*c.value.aspectRatio),M>G&&(M=G,O=M/c.value.aspectRatio),O>U&&(O=U,M=O*c.value.aspectRatio),c.value.constrainedWidth=M,c.value.constrainedHeight=O,_applyImageResizePreview(M,O),o("resize-move",{blockId:r.imageElement.getAttribute("data-sd-block-id"),width:M,height:O})},b=v(_updateImageResize,Vlr),A=b.throttled;',
  },
  {
    label: 'commit or restore the live preview on pointer release',
    from: 'function w(x){if(!c.value)return;const C=c.value.constrainedWidth,k=c.value.constrainedHeight,P=r.imageElement?.getAttribute("data-sd-block-id");document.removeEventListener("mousemove",A),document.removeEventListener("mouseup",w),document.removeEventListener("keydown",S);const E=i.value;if(E?.view){const M=E.view.dom;M&&M.style&&(M.style.pointerEvents="auto")}const L=Math.abs(C-c.value.initialWidth),R=Math.abs(k-c.value.initialHeight);!u.value&&(L>HXe||R>HXe)&&(T(P,C,k),o("resize-end",{blockId:P,finalWidth:C,finalHeight:k})),c.value=null}',
    to: 'function w(x){if(!c.value)return;b.cancel(),!u.value&&x instanceof MouseEvent&&_updateImageResize(x);const C=c.value.constrainedWidth,k=c.value.constrainedHeight,P=r.imageElement?.getAttribute("data-sd-block-id");document.removeEventListener("mousemove",A),document.removeEventListener("mouseup",w),document.removeEventListener("keydown",S);const E=i.value;if(E?.view){const M=E.view.dom;M&&M.style&&(M.style.pointerEvents="auto")}const L=Math.abs(C-c.value.initialWidth),R=Math.abs(k-c.value.initialHeight),M=!u.value&&(L>HXe||R>HXe),O=M&&T(P,C,k);_endImageResizePreview(!O),O&&o("resize-end",{blockId:P,finalWidth:C,finalHeight:k}),c.value=null}',
  },
  {
    label: 'return the minified transaction outcome',
    from: 'function T(x,C,k){const P=i.value;if(!(!n(P)||!r.imageElement||a.value)){if(!Number.isFinite(C)||!Number.isFinite(k)||C<=0||k<=0){o("resize-error",{blockId:x,error:"Invalid dimensions: width and height must be positive finite numbers"});return}try{const{state:E,dispatch:L}=P.view,R=E.tr,M=r.imageElement.getAttribute("data-pm-start");if(!M){o("resize-error",{blockId:x,error:"Image position marker (data-pm-start) not found"});return}const O=parseInt(M,10);if(!Number.isFinite(O)||O<0){o("resize-error",{blockId:x,error:"Invalid image position marker"});return}const H=E.doc.nodeAt(O);if(!H||H.type.name!=="image"){o("resize-error",{blockId:x,error:"Invalid image node at position"});return}R.setNodeAttribute(O,"size",{width:Math.round(C),height:Math.round(k)});const W=E.doc.resolve(O);for(let G=W.depth;G>0;G--){const U=W.node(G);if(!Am(U))continue;const F=Number.parseInt(U.attrs?.sdBlockRev,10);Number.isFinite(F)&&R.setNodeAttribute(W.before(G),"sdBlockRev",F+1)}L(R),x&&x.trim()&&Zu.invalidate([x]),o("resize-success",{blockId:x,newWidth:C,newHeight:k})}catch(E){o("resize-error",{blockId:x,error:E instanceof Error?E.message:String(E)})}}}',
    to: 'function T(x,C,k){const P=i.value;if(!n(P)||!r.imageElement||a.value)return!1;if(!Number.isFinite(C)||!Number.isFinite(k)||C<=0||k<=0)return o("resize-error",{blockId:x,error:"Invalid dimensions: width and height must be positive finite numbers"}),!1;try{const{state:E,dispatch:L}=P.view,R=E.tr,M=r.imageElement.getAttribute("data-pm-start");if(!M)return o("resize-error",{blockId:x,error:"Image position marker (data-pm-start) not found"}),!1;const O=parseInt(M,10);if(!Number.isFinite(O)||O<0)return o("resize-error",{blockId:x,error:"Invalid image position marker"}),!1;const H=E.doc.nodeAt(O);if(!H||H.type.name!=="image")return o("resize-error",{blockId:x,error:"Invalid image node at position"}),!1;R.setNodeAttribute(O,"size",{width:Math.round(C),height:Math.round(k)});const W=E.doc.resolve(O);for(let G=W.depth;G>0;G--){const U=W.node(G);if(!Am(U))continue;const F=Number.parseInt(U.attrs?.sdBlockRev,10);Number.isFinite(F)&&R.setNodeAttribute(W.before(G),"sdBlockRev",F+1)}return L(R),x&&x.trim()&&Zu.invalidate([x]),o("resize-success",{blockId:x,newWidth:C,newHeight:k}),!0}catch(E){return o("resize-error",{blockId:x,error:E instanceof Error?E.message:String(E)}),!1}}',
  },
  {
    label: 'restore minified live preview on unmount',
    from: 'ti(()=>{if(b.cancel(),c.value){',
    to: 'ti(()=>{if(b.cancel(),_endImageResizePreview(!0),c.value){',
  },
])

console.log('superdoc image-resize patch applied (idempotent)')
