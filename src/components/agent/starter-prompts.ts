import { CheckCheck, FileText, ListTree, Sparkles, type LucideIcon } from 'lucide-react'
import type { LanguageCode, TranslationKey } from '@/lib/i18n/types'

export interface StarterPrompt {
  id: string
  icon: LucideIcon
  labelKey: TranslationKey
  defaultText: Record<LanguageCode, string>
}

export const STARTER_PROMPTS: StarterPrompt[] = [
  {
    id: 'summarize',
    icon: FileText,
    labelKey: 'agentUi.promptSummarize' as const,
    defaultText: {
      'zh-CN': '请总结当前文档的核心要点和关键信息。',
      en: 'Please summarize the key points and core takeaways of the current document.',
      ja: '現在のドキュメントの要点と重要な情報を要約してください。',
      es: 'Por favor, resume los puntos clave y la información fundamental del documento actual.',
      pt: 'Por favor, resuma os pontos principais e as informações essenciais do documento atual.',
      de: 'Bitte fassen Sie die Kernpunkte und wichtigsten Informationen des aktuellen Dokuments zusammen.',
      fr: 'Veuillez résumer les points clés et les informations essentielles du document actuel.',
      ru: 'Пожалуйста, обобщите ключевые моменты и основную информацию текущего документа.',
      ar: 'يرجى تلخيص النقاط الرئيسية والمعلومات الأساسية للمستند الحالي.',
    },
  },
  {
    id: 'polish',
    icon: Sparkles,
    labelKey: 'agentUi.promptPolish' as const,
    defaultText: {
      'zh-CN': '请对当前文档内容进行语言润色，提高表达的流畅度与专业度。',
      en: 'Please polish the text in the current document to improve clarity, flow, and professionalism.',
      ja: '現在のドキュメントの文章を推敲し、読みやすさと表現力を向上させてください。',
      es: 'Por favor, pule el texto del documento actual para mejorar la claridad y el estilo profesional.',
      pt: 'Por favor, revise e aprimore o texto do documento atual para melhorar a fluidez e o profissionalismo.',
      de: 'Bitte überarbeiten Sie den Text des aktuellen Dokuments, um Klarheit und Stil zu verbessern.',
      fr: 'Veuillez peaufiner le texte du document actuel pour améliorer sa clarté et sa fluidité.',
      ru: 'Пожалуйста, отшлифуйте текст текущего документа, улучшив плавность и стиль.',
      ar: 'يرجى تحسين وتنقيح لغة المستند الحالي لزيادة سلاسة التعبير والاحترافية.',
    },
  },
  {
    id: 'fix',
    icon: CheckCheck,
    labelKey: 'agentUi.promptFixErrors' as const,
    defaultText: {
      'zh-CN': '请检查当前文档中的错别字、语法错误以及排版格式问题。',
      en: 'Please check the current document for spelling, grammar, and formatting errors.',
      ja: '現在のドキュメント内の誤字脱字、文法、書式の問題をチェックしてください。',
      es: 'Por favor, revisa el documento actual en busca de errores ortográficos, gramaticales y de formato.',
      pt: 'Por favor, verifique o documento atual quanto a erros de ortografia, gramática e formatação.',
      de: 'Bitte überprüfen Sie das aktuelle Dokument auf Rechtschreib-, Grammatik- und Formatierungsfehler.',
      fr: 'Veuillez vérifier les fautes d’orthographe, de grammaire et les problèmes de mise en page dans le document actuel.',
      ru: 'Пожалуйста, проверьте текущий документ на наличие орфографических, грамматических и форматирующих ошибок.',
      ar: 'يرجى فحص المستند الحالي للتحقق من الأخطاء الإملائية والنحوية وتنسيق الفقرات.',
    },
  },
  {
    id: 'outline',
    icon: ListTree,
    labelKey: 'agentUi.promptOutline' as const,
    defaultText: {
      'zh-CN': '请为当前文档梳理生成清晰的结构大纲与行动建议。',
      en: 'Please generate a structured outline and actionable next steps for this document.',
      ja: '現在のドキュメントの構成アウトラインと次のアクション項目を作成してください。',
      es: 'Por favor, genera un esquema estructurado y recomendaciones de acción para este documento.',
      pt: 'Por favor, elabore uma estrutura organizada e sugestões de ação para este documento.',
      de: 'Bitte erstellen Sie eine strukturierte Gliederung und Handlungsempfehlungen für dieses Dokument.',
      fr: 'Veuillez générer un plan structuré et des recommandations d’action pour ce document.',
      ru: 'Пожалуйста, создайте структурированный план и рекомендации по действиям для этого документа.',
      ar: 'يرجى إعداد مخطط تفصيلي منظم واقتراحات للخطوات التالية لهذا المستند.',
    },
  },
]
