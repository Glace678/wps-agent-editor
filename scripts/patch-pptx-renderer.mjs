// Applies a local fix to @aiden0z/pptx-renderer (pinned to 1.2.4 in
// package-lock.json) so that paragraph tab stops follow PowerPoint semantics:
//
// 1. The effective default tab size comes from the paragraph pPr defTabSz,
//    then the highest-priority style level that exists (shape lstStyle,
//    layout placeholder lstStyle, master placeholder lstStyle, master
//    textStyles, master defaultTextStyle) — each level's own defTabSz, or the
//    built-in 914400 EMU (96 px) when the level defines none. The presentation
//    defaultTextStyle defTabSz is never consulted (PowerPoint ignores it).
// 2. For a non-bulleted paragraph with a left margin, PowerPoint places the
//    first default tab stop at the margin. CSS tab stops are measured from the
//    content edge, so the first leading tab is rendered as a margin-width
//    inline spacer and the CSS grid is offset accordingly (defTabSz - margin)
//    to reproduce PowerPoint's [margin, defTabSz, 2*defTabSz, ...] stops.
//
// 3. Tab runs use white-space: pre-wrap so tabbed paragraphs still wrap
//    (PowerPoint behavior) instead of overflowing their text box.
//
// Idempotent: safe to run on every install.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(root, 'node_modules', '@aiden0z', 'pptx-renderer', 'dist')

const tabSizeNew = (emus, styleLevel, marginLeft, noBullet, tabSizeVar) => `let tabSizeEmu = null;
      const ownDefTabSz = b.properties ? b.properties.numAttr("defTabSz") : void 0;
      if (ownDefTabSz !== void 0) tabSizeEmu = ownDefTabSz;
      else {
        const tabStyleLevels = [
          ${styleLevel},
          layoutPhLevel,
          masterPhLevel,
          ${emus.textStyles},
          ${emus.masterDefault}
        ];
        for (const tabLevel of tabStyleLevels) {
          if (tabLevel && tabLevel.exists()) {
            const tabDefTabSz = tabLevel.numAttr("defTabSz");
            tabSizeEmu = tabDefTabSz !== void 0 ? tabDefTabSz : 914400;
            break;
          }
        }
        if (tabSizeEmu === null) tabSizeEmu = 914400;
      }
      let tabSizePx = ${emus.toPx}(tabSizeEmu);
      if (${marginLeft} !== void 0 && ${marginLeft} > 0 && (${noBullet} || ${emus.bulletNone} === !0)) {
        tabSizePx = Math.max(1, tabSizePx - ${marginLeft});
      }
      ${tabSizeVar} = \`\${tabSizePx}px\`;`

function apply(file, replacements) {
  const target = path.join(distDir, file)
  const source = readFileSync(target, 'utf8')
  let output = source
  for (const { from, to, label } of replacements) {
    if (output.includes(to)) {
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

// ---------------------------------------------------------------------------
// dist/aiden0z-pptx-renderer.es.js (ESM build, the app's import target)
// ---------------------------------------------------------------------------
apply('aiden0z-pptx-renderer.es.js', [
  {
    label: 'migrate tab grid offset formula',
    from: `      if (A.marginLeft !== void 0 && A.marginLeft > 0 && (R || A.bulletNone === !0)) {
        tabSizePx = Math.min(tabSizePx, A.marginLeft);
      }
      M.style.tabSize = \`\${tabSizePx}px\`;`,
    to: `      if (A.marginLeft !== void 0 && A.marginLeft > 0 && (R || A.bulletNone === !0)) {
        tabSizePx = Math.max(1, tabSizePx - A.marginLeft);
      }
      M.style.tabSize = \`\${tabSizePx}px\`;`,
  },
  {
    label: 'hoist placeholder style levels',
    from: `!v, A = {};
    Qe(A, _e(e.presentation.defaultTextStyle, L))`,
    to: `!v, A = {};
    let masterPhLevel = null, layoutPhLevel = null;
    Qe(A, _e(e.presentation.defaultTextStyle, L))`,
  },
  {
    label: 'capture master placeholder level',
    from: `const T = ir(G);
        Qe(A, _e(T, L));
      }
    }
    if (n) {`,
    to: `const T = ir(G);
        const lvl = _e(T, L);
        masterPhLevel = lvl;
        Qe(A, lvl);
      }
    }
    if (n) {`,
  },
  {
    label: 'capture layout placeholder level',
    from: `const T = ir(G);
        Qe(A, _e(T, L));
      }
    }
    if (Qe(A, _e(t.listStyle, L)), b.properties && Qe(A, b.properties), A.align) {`,
    to: `const T = ir(G);
        const lvl = _e(T, L);
        layoutPhLevel = lvl;
        Qe(A, lvl);
      }
    }
    if (Qe(A, _e(t.listStyle, L)), b.properties && Qe(A, b.properties), A.align) {`,
  },
  {
    label: 'PowerPoint tab stop semantics',
    from: `const G = A.defaultTabSize ?? 96;
      M.style.tabSize = \`\${G}px\`;`,
    to: tabSizeNew(
      { textStyles: '_e(S, L)', masterDefault: '_e(e.master.defaultTextStyle, L)', toPx: 'X', bulletNone: 'A.bulletNone' },
      '_e(t.listStyle, L)',
      'A.marginLeft',
      'R',
      'M.style.tabSize',
    ),
  },
  {
    label: 'tab runs wrap and honor the margin first stop',
    from: `if (T.text && T.text.includes("	"))
        O.textContent = T.text, O.style.whiteSpace = "pre";`,
    to: `if (T.text && T.text.includes("	")) {
        O.style.whiteSpace = "pre-wrap";
        const firstVisible = b.runs.findIndex((Pt) => Pt.text != null && Pt.text.length > 0) === G;
        if (firstVisible && A.marginLeft !== void 0 && A.marginLeft > 0 && (R || A.bulletNone === !0) && T.text.startsWith("	")) {
          const spacer = document.createElement("span");
          spacer.style.display = "inline-block";
          spacer.style.width = \`\${A.marginLeft}px\`;
          O.appendChild(spacer);
          O.appendChild(document.createTextNode(T.text.slice(1)));
        } else {
          O.textContent = T.text;
        }
      }`,
  },
  {
    label: 'never force nowrap on tab runs',
    from: `ot && (T.text === ot || T.text && T.text !== ot && J) && (O.style.whiteSpace = "nowrap");`,
    to: `T.text && !T.text.includes("	") && ot && (T.text === ot || T.text && T.text !== ot && J) && (O.style.whiteSpace = "nowrap");`,
  },
])

// ---------------------------------------------------------------------------
// dist/aiden0z-pptx-renderer.browser.es.js
// ---------------------------------------------------------------------------
apply('aiden0z-pptx-renderer.browser.es.js', [
  {
    label: 'migrate tab grid offset formula',
    from: `      if (C.marginLeft !== void 0 && C.marginLeft > 0 && (I || C.bulletNone === !0)) {
        tabSizePx = Math.min(tabSizePx, C.marginLeft);
      }
      _.style.tabSize = \`\${tabSizePx}px\`;`,
    to: `      if (C.marginLeft !== void 0 && C.marginLeft > 0 && (I || C.bulletNone === !0)) {
        tabSizePx = Math.max(1, tabSizePx - C.marginLeft);
      }
      _.style.tabSize = \`\${tabSizePx}px\`;`,
  },
  {
    label: 'hoist placeholder style levels',
    from: `&& x === f && !S, C = {};
    na(C, $i(r.presentation.defaultTextStyle, $))`,
    to: `&& x === f && !S, C = {};
    let masterPhLevel = null, layoutPhLevel = null;
    na(C, $i(r.presentation.defaultTextStyle, $))`,
  },
  {
    label: 'capture master placeholder level',
    from: `const U = hm(r.master.placeholders, t);
      if (U) {
        const N = fm(U);
        na(C, $i(N, $));
      }`,
    to: `const U = hm(r.master.placeholders, t);
      if (U) {
        const N = fm(U);
        const lvl = $i(N, $);
        masterPhLevel = lvl;
        na(C, lvl);
      }`,
  },
  {
    label: 'capture layout placeholder level',
    from: `      if (U) {
        const N = fm(U);
        na(C, $i(N, $));
      }
    }
    if (na(C, $i(e.listStyle, $)), b.properties && na(C, b.properties), C.align) {`,
    to: `      if (U) {
        const N = fm(U);
        const lvl = $i(N, $);
        layoutPhLevel = lvl;
        na(C, lvl);
      }
    }
    if (na(C, $i(e.listStyle, $)), b.properties && na(C, b.properties), C.align) {`,
  },
  {
    label: 'PowerPoint tab stop semantics',
    from: `const U = C.defaultTabSize ?? 96;
      _.style.tabSize = \`\${U}px\`;`,
    to: tabSizeNew(
      { textStyles: '$i(T, $)', masterDefault: '$i(r.master.defaultTextStyle, $)', toPx: 'gt', bulletNone: 'C.bulletNone' },
      '$i(e.listStyle, $)',
      'C.marginLeft',
      'I',
      '_.style.tabSize',
    ),
  },
  {
    label: 'tab runs wrap and honor the margin first stop',
    from: `if (N.text && N.text.includes("	"))
        X.textContent = N.text, X.style.whiteSpace = "pre";`,
    to: `if (N.text && N.text.includes("	")) {
        X.style.whiteSpace = "pre-wrap";
        const firstVisible = b.runs.findIndex((Pt) => Pt.text != null && Pt.text.length > 0) === U;
        if (firstVisible && C.marginLeft !== void 0 && C.marginLeft > 0 && (I || C.bulletNone === !0) && N.text.startsWith("	")) {
          const spacer = document.createElement("span");
          spacer.style.display = "inline-block";
          spacer.style.width = \`\${C.marginLeft}px\`;
          X.appendChild(spacer);
          X.appendChild(document.createTextNode(N.text.slice(1)));
        } else {
          X.textContent = N.text;
        }
      }`,
  },
  {
    label: 'never force nowrap on tab runs',
    from: `ct && (N.text === ct || N.text && N.text !== ct && nt) && (X.style.whiteSpace = "nowrap");`,
    to: `N.text && !N.text.includes("	") && ct && (N.text === ct || N.text && N.text !== ct && nt) && (X.style.whiteSpace = "nowrap");`,
  },
])

// ---------------------------------------------------------------------------
// dist/aiden0z-pptx-renderer.cjs
// ---------------------------------------------------------------------------
apply('aiden0z-pptx-renderer.cjs', [
  {
    label: 'migrate tab grid offset formula',
    from: `tabSizePx=Math.min(tabSizePx,A.marginLeft)}M.style.tabSize=`,
    to: `tabSizePx=Math.max(1,tabSizePx-A.marginLeft)}M.style.tabSize=`,
  },
  {
    label: 'hoist placeholder style levels',
    from: `&&m===x&&!v,A={};Je(A,Ve(e.presentation.defaultTextStyle,L))`,
    to: `&&m===x&&!v,A={};let masterPhLevel=null,layoutPhLevel=null;Je(A,Ve(e.presentation.defaultTextStyle,L))`,
  },
  {
    label: 'capture placeholder style levels',
    from: `Je(A,Ve(S,L)),n){const G=dr(e.master.placeholders,n);if(G){const T=hr(G);Je(A,Ve(T,L))}}if(n){const G=dr(e.layout.placeholders.map(T=>T.node),n);if(G){const T=hr(G);Je(A,Ve(T,L))}}`,
    to: `Je(A,Ve(S,L)),n){const G=dr(e.master.placeholders,n);if(G){const T=hr(G);const lvl=Ve(T,L);masterPhLevel=lvl;Je(A,lvl)}}if(n){const G=dr(e.layout.placeholders.map(T=>T.node),n);if(G){const T=hr(G);const lvl=Ve(T,L);layoutPhLevel=lvl;Je(A,lvl)}}`,
  },
  {
    label: 'PowerPoint tab stop semantics',
    from: `const G=A.defaultTabSize??96;M.style.tabSize=\`\${G}px\``,
    to: `let tabSizeEmu=null;const ownDefTabSz=b.properties?b.properties.numAttr("defTabSz"):void 0;if(ownDefTabSz!==void 0)tabSizeEmu=ownDefTabSz;else{const tabStyleLevels=[Ve(t.listStyle,L),layoutPhLevel,masterPhLevel,Ve(S,L),Ve(e.master.defaultTextStyle,L)];for(const tabLevel of tabStyleLevels){if(tabLevel&&tabLevel.exists()){const tabDefTabSz=tabLevel.numAttr("defTabSz");tabSizeEmu=tabDefTabSz!==void 0?tabDefTabSz:914400;break}}if(tabSizeEmu===null)tabSizeEmu=914400}let tabSizePx=X(tabSizeEmu);if(A.marginLeft!==void 0&&A.marginLeft>0&&(R||A.bulletNone===!0)){tabSizePx=Math.max(1,tabSizePx-A.marginLeft)}M.style.tabSize=\`\${tabSizePx}px\``,
  },
  {
    label: 'tab runs wrap and honor the margin first stop',
    from: `if(T.text&&T.text.includes("\t"))O.textContent=T.text,O.style.whiteSpace="pre";`,
    to: `if(T.text&&T.text.includes("\t")){O.style.whiteSpace="pre-wrap";const firstVisible=b.runs.findIndex(Pt=>Pt.text!=null&&Pt.text.length>0)===G;if(firstVisible&&A.marginLeft!==void 0&&A.marginLeft>0&&(R||A.bulletNone===!0)&&T.text.startsWith("\t")){const spacer=document.createElement("span");spacer.style.display="inline-block";spacer.style.width=\`\${A.marginLeft}px\`;O.appendChild(spacer);O.appendChild(document.createTextNode(T.text.slice(1)))}else{O.textContent=T.text}}`,
  },
  {
    label: 'never force nowrap on tab runs',
    from: `ot&&(T.text===ot||T.text&&T.text!==ot&&J)&&(O.style.whiteSpace="nowrap")`,
    to: `T.text&&!T.text.includes("\t")&&ot&&(T.text===ot||T.text&&T.text!==ot&&J)&&(O.style.whiteSpace="nowrap")`,
  },
])

console.log('pptx-renderer patch applied (idempotent)')
