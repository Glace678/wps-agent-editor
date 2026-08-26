import path from 'node:path'
import fs from 'node:fs/promises'
import jwt from 'jsonwebtoken'
import { getFileType, normalizePath } from './file.service'
import { getLanguage } from '../i18n/types'
import type { WordEditPlan, WordPlaybackControl } from '../../src/types/document'
import type { ArtifactDraftCreateRequest, CodeDraftCreateRequest } from '../../src/types/artifact-review'
import { assertStrongOnlyOfficeSecret } from '../../server/onlyoffice-bridge/bridge'

export interface OnlyOfficeConfig {
  documentServerUrl: string
  bridgeUrl: string
  jwtSecret: string
}

export interface OnlyOfficeDocumentRegistration {
  documentId: string
  documentUrl: string
  callbackUrl: string
}

export interface EditorConfig {
  documentType: 'word' | 'cell' | 'slide' | 'pdf'
  document: {
    fileType: string
    key: string
    title: string
    url: string
    permissions: {
      edit: boolean
      download: boolean
      print: boolean
    }
  }
  editorConfig: {
    callbackUrl: string
    mode: 'edit' | 'view'
    lang: string
    user: {
      id: string
      name: string
    }
    coEditing: {
      mode: 'fast' | 'strict'
      change: boolean
    }
    customization: {
      autosave: boolean
      forcesave: boolean
      compactToolbar: boolean
    }
  }
  token?: string
}

function signConfig(config: object, secret: string): string {
  return jwt.sign(config, assertStrongOnlyOfficeSecret(secret), {
    algorithm: 'HS256',
    expiresIn: '1h',
  })
}

export async function buildEditorConfig(
  filePath: string,
  userId: string,
  userName: string,
  ooConfig: OnlyOfficeConfig,
  registration: OnlyOfficeDocumentRegistration,
): Promise<EditorConfig> {
  const normalized = normalizePath(filePath)
  const ext = path.extname(normalized).slice(1).toLowerCase()
  const docType = getFileType(normalized)
  const fileName = path.basename(normalized)

  const config: EditorConfig = {
    documentType: docType === 'unknown' ? 'word' : docType,
    document: {
      fileType: ext,
      key: registration.documentId,
      title: fileName,
      url: registration.documentUrl,
      permissions: {
        edit: docType !== 'pdf',
        download: true,
        print: true,
      },
    },
    editorConfig: {
      callbackUrl: registration.callbackUrl,
      mode: docType === 'pdf' ? 'view' : 'edit',
      lang: getLanguage() === 'pt' ? 'pt-BR' : getLanguage(),
      user: { id: userId, name: userName },
      coEditing: { mode: 'fast', change: true },
      customization: {
        autosave: true,
        forcesave: true,
        compactToolbar: false,
      },
    },
  }

  config.token = signConfig(config, ooConfig.jwtSecret)

  return config
}

export async function buildAgentEditorConfig(
  filePath: string,
  agentId: string,
  agentName: string,
  ooConfig: OnlyOfficeConfig,
  registration: OnlyOfficeDocumentRegistration,
): Promise<EditorConfig> {
  return buildEditorConfig(filePath, `agent-${agentId}`, agentName, ooConfig, registration)
}

export interface AgentEditCommand {
  action:
    | 'insertText'
    | 'replaceText'
    | 'readDocument'
    | 'appendParagraph'
    | 'inspectWordDocument'
    | 'searchWordOperations'
    | 'validateWordPlan'
    | 'applyWordPlan'
    | 'controlWordPlayback'
    | 'readExcelRange'
    | 'setExcelFormula'
    | 'inspectDocumentArtifact'
    | 'searchDocumentOperations'
    | 'createDocumentDraft'
    | 'insertCodeText'
    | 'replaceCodeRange'
    | 'deleteCodeRange'
    | 'inspectCodeWorkspace'
    | 'readCodeArtifact'
    | 'createCodeDraft'
  text?: string
  search?: string
  replace?: string
  all?: boolean
  position?: 'cursor' | 'end' | 'start'
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
  sheet?: string
  range?: string
  target?: string
  formula?: string
  operationId?: string
  runId?: string
  agentId?: string
  agentName?: string
  baseRevision?: number
  plan?: WordEditPlan
  control?: WordPlaybackControl
  query?: string
  limit?: number
  artifactDraft?: Omit<ArtifactDraftCreateRequest, 'sourcePath' | 'runId' | 'agentId' | 'agentName'>
  artifactId?: string
  startOffset?: number
  endOffset?: number
  codeDraft?: CodeDraftCreateRequest
}

export function buildConnectorScript(command: AgentEditCommand): string {
  const payload = JSON.stringify(command)
  return `
    (function() {
      if (typeof Asc === 'undefined' || !Asc.scope) {
        return { success: false, error: 'OnlyOffice API not ready' };
      }
      var cmd = ${payload};
      try {
        Asc.scope.command = cmd;
        // Connector API 在编辑器加载后可用
        if (window.connector) {
          return new Promise(function(resolve) {
            window.connector.callCommand(function() {
              var oDocument = Api.GetDocument();
              if (cmd.action === 'insertText') {
                var oParagraph = Api.CreateParagraph();
                oParagraph.AddText(cmd.text || '');
                if (cmd.position === 'start') {
                  oDocument.InsertContent([oParagraph], 0);
                } else {
                  oDocument.InsertContent([oParagraph]);
                }
                resolve({ success: true });
              } else if (cmd.action === 'appendParagraph') {
                var p = Api.CreateParagraph();
                p.AddText(cmd.text || '');
                oDocument.Push(p);
                resolve({ success: true });
              } else if (cmd.action === 'replaceText') {
                // 简化版：搜索替换通过段落遍历实现
                var count = oDocument.Search(cmd.search || '');
                if (count && count.length > 0) {
                  for (var i = 0; i < count.length; i++) {
                    count[i].SetText(cmd.replace || '');
                    if (!cmd.all) break;
                  }
                }
                resolve({ success: true, replaced: count ? count.length : 0 });
              } else if (cmd.action === 'readDocument') {
                var text = '';
                var paras = oDocument.GetAllParagraphs();
                for (var j = 0; j < paras.length; j++) {
                  text += paras[j].GetText() + '\\n';
                }
                resolve({ success: true, content: text });
              }
            }, function() {
              resolve({ success: false, error: 'Command execution failed' });
            });
          });
        }
        return { success: false, error: 'Connector not initialized' };
      } catch(e) {
        return { success: false, error: e.message };
      }
    })();
  `
}

export async function copyToBridgeCache(filePath: string, cacheDir: string): Promise<string> {
  const normalized = normalizePath(filePath)
  const fileName = path.basename(normalized)
  const dest = path.join(cacheDir, fileName)
  await fs.mkdir(cacheDir, { recursive: true })
  await fs.copyFile(normalized, dest)
  return dest
}
