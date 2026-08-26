# WPS Agent Editor - 9 种语言国际化翻译校对与修复指南 (I18N Fix Specification)

> **文档说明 (Instructions for AI / LLM)**:
> 本文档记录了 `wps-agent-editor` 软件中 9 种语言（`zh-CN`, `en`, `ja`, `es`, `pt`, `de`, `fr`, `ru`, `ar`）的翻译校对结果。
> **基准语言为中文（`zh-CN`）**。
> 本规范详细列出了所有待修复的代码位置、键路径（Key）、问题原因、以及各语言的**标准修复译文**。
> 代码文件所在目录：`src/lib/i18n/locales/`
> - `zh-CN.ts`（中文 - 基准）
> - `en.ts`（英文）
> - `ja.ts`（日文）
> - `es.ts`（西班牙文）
> - `pt.ts`（巴西葡萄牙语）
> - `de.ts`（德文）
> - `fr.ts`（法文）
> - `ru.ts`（俄文）
> - `ar.ts`（阿拉伯文）

---

## 目录
1. [任务概述](#1-任务概述)
2. [第一部分：codeEditor 模块 7 语翻译补全（62 个键）](#2-第一部分codeeditor-模块-7-语翻译补全62-个键)
3. [第二部分：bottomPanel 模块 7 语翻译补全（30 个键）](#3-第二部分bottompanel-模块-7-语翻译补全)
4. [第三部分：fileHandler 模块代码文件未翻译修复](#4-第三部分filehandler-模块代码文件未翻译修复)
5. [第四部分：德语 (de.ts) 术语与词义偏差修正](#5-第四部分德语-dets-术语与词义偏差修正)
6. [第五部分：阿拉伯语 (ar.ts) 术语一致性修正](#6-第五部分阿拉伯语-arts-术语一致性修正)
7. [第六部分：巴西葡萄牙语 (pt.ts) 术语一致性修正](#7-第六部分巴西葡萄牙语-ptts-术语一致性修正)
8. [第七部分：记事本模块 (notepad) 动词遗漏与条件补充](#8-第七部分记事本模块-notepad-动词遗漏与条件补充)
9. [第八部分：法语 (fr.ts) 印刷排版弯引号规范化](#9-第八部分法语-frts-印刷排版弯引号规范化)
10. [快速自动化验收方式](#10-快速自动化验收方式)

---

## 1. 任务概述

本项目的翻译采用 TypeScript 嵌套对象组织。需要修复的主要问题包括：
1. **代码编辑器 (`codeEditor`) 与 底部面板 (`bottomPanel`)**：在 `ja.ts`, `es.ts`, `pt.ts`, `de.ts`, `fr.ts`, `ru.ts`, `ar.ts` 中，所有键值均照抄了英文 `en.ts`，需要全部填充为高质量的对应语言译文。
2. **个别词条的术语误译与语境不符**（如德语将“浏览”译为“文件夹”、阿拉伯语突变 Agent 为普通名词等）。
3. **记事本设置中遗漏动词“打开”或前置条件**。
4. **法语标点排版符号统一**（仅将翻译值中字母之间的省音直撇号 `'` 统一为排版弯撇号 `’`）。
5. **动态计数**：现有 `t()` 接口不提供复数规则，因此英语、西班牙语、巴西葡萄牙语、德语、法语、俄语和阿拉伯语采用不依赖数词变形的标签式表达；中文和日语保留量词安全表达。所有计数文案必须在 `{count}=0/1/2` 时正确插值。

---

## 2. 第一部分：codeEditor 模块 7 语翻译补全（62 个键）

修改目标文件：`src/lib/i18n/locales/{ja,es,pt,de,fr,ru,ar}.ts`
对象路径：`export const <lang>: Translation = { ... codeEditor: { ... } }`

以下为各语言的标准修复字典：

### `codeEditor.title`
- **zh-CN (基准)**: `代码编辑器`
- **en (参考)**: `Code Editor`
- **ja (修复为)**: `コードエディター`
- **es (修复为)**: `Editor de código`
- **pt (修复为)**: `Editor de código`
- **de (修复为)**: `Code-Editor`
- **fr (修复为)**: `Éditeur de code`
- **ru (修复为)**: `Редактор кода`
- **ar (修复为)**: `محرر التعليمات البرمجية`

### `codeEditor.loading`
- **zh-CN (基准)**: `正在加载源代码...`
- **en (参考)**: `Loading source file...`
- **ja (修复为)**: `ソースファイルを読み込んでいます...`
- **es (修复为)**: `Cargando archivo de código fuente...`
- **pt (修复为)**: `Carregando arquivo de código-fonte...`
- **de (修复为)**: `Quelldatei wird geladen...`
- **fr (修复为)**: `Chargement du fichier source...`
- **ru (修复为)**: `Загрузка исходного файла...`
- **ar (修复为)**: `جارٍ تحميل ملف التعليمات البرمجية المصدر...`

### `codeEditor.cannotLoad`
- **zh-CN (基准)**: `无法加载此源代码文件。`
- **en (参考)**: `Could not load this source file.`
- **ja (修复为)**: `このソースファイルを読み込めませんでした。`
- **es (修复为)**: `No se pudo cargar este archivo de código fuente.`
- **pt (修复为)**: `Não foi possível carregar este arquivo de código-fonte.`
- **de (修复为)**: `Diese Quelldatei konnte nicht geladen werden.`
- **fr (修复为)**: `Impossible de charger ce fichier source.`
- **ru (修复为)**: `Не удалось загрузить этот исходный файл.`
- **ar (修复为)**: `تعذر تحميل ملف التعليمات البرمجية المصدر هذا.`

### `codeEditor.runCode`
- **zh-CN (基准)**: `运行代码`
- **en (参考)**: `Run Code`
- **ja (修复为)**: `コードを実行`
- **es (修复为)**: `Ejecutar código`
- **pt (修复为)**: `Executar código`
- **de (修复为)**: `Code ausführen`
- **fr (修复为)**: `Exécuter le code`
- **ru (修复为)**: `Запустить код`
- **ar (修复为)**: `تشغيل التعليمات البرمجية`

### `codeEditor.running`
- **zh-CN (基准)**: `正在运行...`
- **en (参考)**: `Running...`
- **ja (修复为)**: `実行中...`
- **es (修复为)**: `Ejecutando...`
- **pt (修复为)**: `Executando...`
- **de (修复为)**: `Wird ausgeführt...`
- **fr (修复为)**: `Exécution en cours...`
- **ru (修复为)**: `Выполняется...`
- **ar (修复为)**: `جارٍ التشغيل...`

### `codeEditor.output`
- **zh-CN (基准)**: `输出`
- **en (参考)**: `Output`
- **ja (修复为)**: `出力`
- **es (修复为)**: `Salida`
- **pt (修复为)**: `Saída`
- **de (修复为)**: `Ausgabe`
- **fr (修复为)**: `Sortie`
- **ru (修复为)**: `Вывод`
- **ar (修复为)**: `المخرجات`

### `codeEditor.references`
- **zh-CN (基准)**: `引用`
- **en (参考)**: `References`
- **ja (修复为)**: `参照`
- **es (修复为)**: `Referencias`
- **pt (修复为)**: `Referências`
- **de (修复为)**: `Referenzen`
- **fr (修复为)**: `Références`
- **ru (修复为)**: `Ссылки`
- **ar (修复为)**: `المراجع`

### `codeEditor.clearOutput`
- **zh-CN (基准)**: `清空输出`
- **en (参考)**: `Clear output`
- **ja (修复为)**: `出力をクリア`
- **es (修复为)**: `Borrar salida`
- **pt (修复为)**: `Limpar saída`
- **de (修复为)**: `Ausgabe löschen`
- **fr (修复为)**: `Effacer la sortie`
- **ru (修复为)**: `Очистить вывод`
- **ar (修复为)**: `مسح المخرجات`

### `codeEditor.copyOutput`
- **zh-CN (基准)**: `复制输出`
- **en (参考)**: `Copy output`
- **ja (修复为)**: `出力をコピー`
- **es (修复为)**: `Copiar salida`
- **pt (修复为)**: `Copiar saída`
- **de (修复为)**: `Ausgabe kopieren`
- **fr (修复为)**: `Copier la sortie`
- **ru (修复为)**: `Копировать вывод`
- **ar (修复为)**: `نسخ المخرجات`

### `codeEditor.closePanel`
- **zh-CN (基准)**: `关闭面板`
- **en (参考)**: `Close panel`
- **ja (修复为)**: `パネルを閉じる`
- **es (修复为)**: `Cerrar panel`
- **pt (修复为)**: `Fechar painel`
- **de (修复为)**: `Bereich schließen`
- **fr (修复为)**: `Fermer le panneau`
- **ru (修复为)**: `Закрыть панель`
- **ar (修复为)**: `إغلاق اللوحة`

### `codeEditor.noOutput`
- **zh-CN (基准)**: `运行当前文件后将在此处显示输出。`
- **en (参考)**: `Run the current file to see output.`
- **ja (修复为)**: `現在のファイルを実行すると、ここに出力が表示されます。`
- **es (修复为)**: `Ejecuta el archivo actual para ver la salida aquí.`
- **pt (修复为)**: `Execute o arquivo atual para ver a saída aqui.`
- **de (修复为)**: `Führen Sie die aktuelle Datei aus, um die Ausgabe hier zu sehen.`
- **fr (修复为)**: `Exécutez le fichier actuel pour voir la sortie ici.`
- **ru (修复为)**: `Запустите текущий файл, чтобы увидеть вывод.`
- **ar (修复为)**: `شغّل الملف الحالي لرؤية المخرجات هنا.`

### `codeEditor.runFinished`
- **zh-CN (基准)**: `进程已结束，退出代码 {code}，耗时 {duration} 毫秒。`
- **en (参考)**: `Process finished with exit code {code} in {duration} ms.`
- **ja (修复为)**: `プロセスが終了しました。終了コード {code}、所要時間 {duration} ミリ秒。`
- **es (修复为)**: `Proceso finalizado con código de salida {code} en {duration} ms.`
- **pt (修复为)**: `Processo finalizado com código de saída {code} em {duration} ms.`
- **de (修复为)**: `Prozess mit Exit-Code {code} in {duration} ms beendet.`
- **fr (修复为)**: `Processus terminé avec le code de sortie {code} en {duration} ms.`
- **ru (修复为)**: `Процесс завершён с кодом возврата {code} за {duration} мс.`
- **ar (修复为)**: `انتهت العملية برمز الخروج {code} في {duration} مللي ثانية.`

### `codeEditor.runtimeMissing`
- **zh-CN (基准)**: `未在 PATH 中找到所需的编译器或运行时。`
- **en (参考)**: `The required compiler or runtime was not found in PATH.`
- **ja (修复为)**: `必要なコンパイラまたはランタイムが PATH 内に見つかりませんでした。`
- **es (修复为)**: `No se encontró el compilador o entorno de ejecución necesario en el PATH.`
- **pt (修复为)**: `O compilador ou ambiente de execução necessário não foi encontrado no PATH.`
- **de (修复为)**: `Der erforderliche Compiler oder die Laufzeitumgebung wurde nicht im PATH gefunden.`
- **fr (修复为)**: `Le compilateur ou l’environnement d’exécution requis est introuvable dans le PATH.`
- **ru (修复为)**: `Требуемый компилятор или среда выполнения не найдены в PATH.`
- **ar (修复为)**: `لم يتم العثور على المترجم أو بيئة التشغيل المطلوبة في PATH.`

### `codeEditor.unsupportedRunner`
- **zh-CN (基准)**: `此文件类型尚未配置运行命令。`
- **en (参考)**: `Run Code is not configured for this file type.`
- **ja (修复为)**: `このファイル形式の実行コマンドは設定されていません。`
- **es (修复为)**: `La ejecución de código no está configurada para este tipo de archivo.`
- **pt (修复为)**: `A execução de código não está configurada para este tipo de arquivo.`
- **de (修复为)**: `Für diesen Dateityp ist kein Ausführungsbefehl konfiguriert.`
- **fr (修复为)**: `L’exécution de code n’est pas configurée pour ce type de fichier.`
- **ru (修复为)**: `Для этого типа файлов команда запуска не настроена.`
- **ar (修复为)**: `لم يتم تكوين أمر تشغيل التعليمات البرمجية لنوع الملف هذا.`

### `codeEditor.timedOut`
- **zh-CN (基准)**: `运行超过 30 秒，已停止。`
- **en (参考)**: `Execution stopped after 30 seconds.`
- **ja (修复为)**: `実行時間が 30 秒を超えたため停止しました。`
- **es (修复为)**: `La ejecución se detuvo tras 30 segundos.`
- **pt (修复为)**: `A execução foi interrompida após 30 segundos.`
- **de (修复为)**: `Die Ausführung wurde nach 30 Sekunden gestoppt.`
- **fr (修复为)**: `L’exécution s’est arrêtée après 30 secondes.`
- **ru (修复为)**: `Выполнение остановлено по истечении 30 секунд.`
- **ar (修复为)**: `توقف التنفيذ بعد 30 ثانية.`

### `codeEditor.goToDefinition`
- **zh-CN (基准)**: `转到定义`
- **en (参考)**: `Go to Definition`
- **ja (修复为)**: `定義へ移動`
- **es (修复为)**: `Ir a la definición`
- **pt (修复为)**: `Ir para definição`
- **de (修复为)**: `Zur Definition`
- **fr (修复为)**: `Atteindre la définition`
- **ru (修复为)**: `Перейти к определению`
- **ar (修复为)**: `الانتقال إلى التعريف`

### `codeEditor.goToDeclaration`
- **zh-CN (基准)**: `转到声明`
- **en (参考)**: `Go to Declaration`
- **ja (修复为)**: `宣言へ移動`
- **es (修复为)**: `Ir a la declaración`
- **pt (修复为)**: `Ir para declaração`
- **de (修复为)**: `Zur Deklaration`
- **fr (修复为)**: `Atteindre la déclaration`
- **ru (修复为)**: `Перейти к объявлению`
- **ar (修复为)**: `الانتقال إلى الإعلان`

### `codeEditor.goToTypeDefinition`
- **zh-CN (基准)**: `转到类型定义`
- **en (参考)**: `Go to Type Definition`
- **ja (修复为)**: `型定義へ移動`
- **es (修复为)**: `Ir a la definición de tipo`
- **pt (修复为)**: `Ir para definição de tipo`
- **de (修复为)**: `Zur Typdefinition`
- **fr (修复为)**: `Atteindre la définition de type`
- **ru (修复为)**: `Перейти к определению типа`
- **ar (修复为)**: `الانتقال إلى تعريف النوع`

### `codeEditor.goToImplementation`
- **zh-CN (基准)**: `转到实现`
- **en (参考)**: `Go to Implementations`
- **ja (修复为)**: `実装箇所へ移動`
- **es (修复为)**: `Ir a las implementaciones`
- **pt (修复为)**: `Ir para implementações`
- **de (修复为)**: `Zu den Implementierungen`
- **fr (修复为)**: `Atteindre les implémentations`
- **ru (修复为)**: `Перейти к реализациям`
- **ar (修复为)**: `الانتقال إلى عمليات التنفيذ`

### `codeEditor.goToReferences`
- **zh-CN (基准)**: `转到引用`
- **en (参考)**: `Go to References`
- **ja (修复为)**: `参照へ移動`
- **es (修复为)**: `Ir a las referencias`
- **pt (修复为)**: `Ir para referências`
- **de (修复为)**: `Zu den Referenzen`
- **fr (修复为)**: `Atteindre les références`
- **ru (修复为)**: `Перейти к ссылкам`
- **ar (修复为)**: `الانتقال إلى المراجع`

### `codeEditor.peek`
- **zh-CN (基准)**: `快速查看`
- **en (参考)**: `Peek`
- **ja (修复为)**: `クイック表示`
- **es (修复为)**: `Inspeccionar`
- **pt (修复为)**: `Espiar`
- **de (修复为)**: `Vorschau`
- **fr (修复为)**: `Aperçu`
- **ru (修复为)**: `Быстрый просмотр`
- **ar (修复为)**: `نظرة سريعة`

### `codeEditor.findAllReferences`
- **zh-CN (基准)**: `查找所有引用`
- **en (参考)**: `Find All References`
- **ja (修复为)**: `すべての参照を検索`
- **es (修复为)**: `Buscar todas las referencias`
- **pt (修复为)**: `Localizar todas as referências`
- **de (修复为)**: `Alle Referenzen suchen`
- **fr (修复为)**: `Rechercher toutes les références`
- **ru (修复为)**: `Найти все ссылки`
- **ar (修复为)**: `البحث عن جميع المراجع`

### `codeEditor.findAllImplementations`
- **zh-CN (基准)**: `查找所有实现`
- **en (参考)**: `Find All Implementations`
- **ja (修复为)**: `すべての実装を検索`
- **es (修复为)**: `Buscar todas las implementaciones`
- **pt (修复为)**: `Localizar todas as implementações`
- **de (修复为)**: `Alle Implementierungen suchen`
- **fr (修复为)**: `Rechercher toutes les implémentations`
- **ru (修复为)**: `Найти все реализации`
- **ar (修复为)**: `البحث عن جميع عمليات التنفيذ`

### `codeEditor.showCallHierarchy`
- **zh-CN (基准)**: `显示调用层次结构`
- **en (参考)**: `Show Call Hierarchy`
- **ja (修复为)**: `呼び出し階層を表示`
- **es (修复为)**: `Mostrar jerarquía de llamadas`
- **pt (修复为)**: `Mostrar hierarquia de chamadas`
- **de (修复为)**: `Aufrufhierarchie anzeigen`
- **fr (修复为)**: `Afficher la hiérarchie des appels`
- **ru (修复为)**: `Показать иерархию вызовов`
- **ar (修复为)**: `إظهار التدرج الهرمي للاستدعاء`

### `codeEditor.showTypeHierarchy`
- **zh-CN (基准)**: `显示类型层次结构`
- **en (参考)**: `Show Type Hierarchy`
- **ja (修复为)**: `型階層を表示`
- **es (修复为)**: `Mostrar jerarquía de tipos`
- **pt (修复为)**: `Mostrar hierarquia de tipos`
- **de (修复为)**: `Typhierarchie anzeigen`
- **fr (修复为)**: `Afficher la hiérarchie des types`
- **ru (修复为)**: `Показать иерархию типов`
- **ar (修复为)**: `إظهار التدرج الهرمي للأنواع`

### `codeEditor.addFileToChat`
- **zh-CN (基准)**: `将文件添加到聊天`
- **en (参考)**: `Add File to Chat`
- **ja (修复为)**: `ファイルをチャットに追加`
- **es (修复为)**: `Agregar archivo al chat`
- **pt (修复为)**: `Adicionar arquivo ao chat`
- **de (修复为)**: `Datei zum Chat hinzufügen`
- **fr (修复为)**: `Ajouter le fichier au chat`
- **ru (修复为)**: `Добавить файл в чат`
- **ar (修复为)**: `إضافة الملف إلى الدردشة`

### `codeEditor.inlineChat`
- **zh-CN (基准)**: `打开内联聊天`
- **en (参考)**: `Open Inline Chat`
- **ja (修复为)**: `インラインチャットを開く`
- **es (修复为)**: `Abrir chat integrado`
- **pt (修复为)**: `Abrir chat embutido`
- **de (修复为)**: `Inline-Chat öffnen`
- **fr (修复为)**: `Ouvrir le chat intégré`
- **ru (修复为)**: `Открыть встроенный чат`
- **ar (修复为)**: `فتح الدردشة المضمنة`

### `codeEditor.explain`
- **zh-CN (基准)**: `说明`
- **en (参考)**: `Explain`
- **ja (修复为)**: `説明`
- **es (修复为)**: `Explicar`
- **pt (修复为)**: `Explicar`
- **de (修复为)**: `Erklären`
- **fr (修复为)**: `Expliquer`
- **ru (修复为)**: `Объяснить`
- **ar (修复为)**: `شرح`

### `codeEditor.review`
- **zh-CN (基准)**: `评审`
- **en (参考)**: `Review`
- **ja (修复为)**: `レビュー`
- **es (修复为)**: `Revisar`
- **pt (修复为)**: `Revisar`
- **de (修复为)**: `Überprüfen`
- **fr (修复为)**: `Réviser`
- **ru (修复为)**: `Рецензировать`
- **ar (修复为)**: `مراجعة`

### `codeEditor.renameSymbol`
- **zh-CN (基准)**: `重命名符号`
- **en (参考)**: `Rename Symbol`
- **ja (修复为)**: `シンボルの名前変更`
- **es (修复为)**: `Cambiar nombre del símbolo`
- **pt (修复为)**: `Renomear símbolo`
- **de (修复为)**: `Symbol umbenennen`
- **fr (修复为)**: `Renommer le symbole`
- **ru (修复为)**: `Переименовать символ`
- **ar (修复为)**: `إعادة تسمية الرمز`

### `codeEditor.changeAllOccurrences`
- **zh-CN (基准)**: `更改所有匹配项`
- **en (参考)**: `Change All Occurrences`
- **ja (修复为)**: `すべての出現箇所を変更`
- **es (修复为)**: `Cambiar todas las coincidencias`
- **pt (修复为)**: `Alterar todas as ocorrências`
- **de (修复为)**: `Alle Vorkommen ändern`
- **fr (修复为)**: `Modifier toutes les occurrences`
- **ru (修复为)**: `Изменить все вхождения`
- **ar (修复为)**: `تغيير جميع التكرارات`

### `codeEditor.refactor`
- **zh-CN (基准)**: `重构...`
- **en (参考)**: `Refactor...`
- **ja (修复为)**: `リファクタリング...`
- **es (修复为)**: `Refactorizar...`
- **pt (修复为)**: `Refatorar...`
- **de (修复为)**: `Refaktorisieren...`
- **fr (修复为)**: `Refactoriser...`
- **ru (修复为)**: `Рефакторинг...`
- **ar (修复为)**: `إعادة هيكلة...`

### `codeEditor.sourceAction`
- **zh-CN (基准)**: `源代码操作...`
- **en (参考)**: `Source Action...`
- **ja (修复为)**: `ソースアクション...`
- **es (修复为)**: `Acción de código fuente...`
- **pt (修复为)**: `Ação de código-fonte...`
- **de (修复为)**: `Quellcode-Aktion...`
- **fr (修复为)**: `Action de code source...`
- **ru (修复为)**: `Действие с исходным кодом...`
- **ar (修复为)**: `إجراء التعليمات البرمجية المصدر...`

### `codeEditor.cut`
- **zh-CN (基准)**: `剪切`
- **en (参考)**: `Cut`
- **ja (修复为)**: `切り取り`
- **es (修复为)**: `Cortar`
- **pt (修复为)**: `Recortar`
- **de (修复为)**: `Ausschneiden`
- **fr (修复为)**: `Couper`
- **ru (修复为)**: `Вырезать`
- **ar (修复为)**: `قص`

### `codeEditor.copy`
- **zh-CN (基准)**: `复制`
- **en (参考)**: `Copy`
- **ja (修复为)**: `コピー`
- **es (修复为)**: `Copiar`
- **pt (修复为)**: `Copiar`
- **de (修复为)**: `Kopieren`
- **fr (修复为)**: `Copier`
- **ru (修复为)**: `Копировать`
- **ar (修复为)**: `نسخ`

### `codeEditor.paste`
- **zh-CN (基准)**: `粘贴`
- **en (参考)**: `Paste`
- **ja (修复为)**: `貼り付け`
- **es (修复为)**: `Pegar`
- **pt (修复为)**: `Colar`
- **de (修复为)**: `Einfügen`
- **fr (修复为)**: `Coller`
- **ru (修复为)**: `Вставить`
- **ar (修复为)**: `لصق`

### `codeEditor.semanticUnavailable`
- **zh-CN (基准)**: `此语言需要配置语言服务才能执行该命令。`
- **en (参考)**: `This language needs a language service for that command.`
- **ja (修复为)**: `この言語でそのコマンドを実行するには言語サービスの設定が必要です。`
- **es (修复为)**: `Este lenguaje necesita un servicio de lenguaje para ese comando.`
- **pt (修复为)**: `Este idioma requer a configuração de um serviço de linguagem para esse comando.`
- **de (修复为)**: `Für diesen Befehl ist ein Sprachdienst für diese Sprache erforderlich.`
- **fr (修复为)**: `Ce langage nécessite un service de langage pour exécuter cette commande.`
- **ru (修复为)**: `Для этой команды требуется настроить языковую службу.`
- **ar (修复为)**: `تحتاج هذه اللغة إلى خدمة لغة لتنفيذ هذا الأمر.`

### `codeEditor.symbolNotFound`
- **zh-CN (基准)**: `光标处没有可用的符号。`
- **en (参考)**: `No symbol was found at the cursor.`
- **ja (修复为)**: `カーソル位置に利用可能なシンボルが見つかりません。`
- **es (修复为)**: `No se encontró ningún símbolo en el cursor.`
- **pt (修复为)**: `Nenhum símbolo foi encontrado no cursor.`
- **de (修复为)**: `An der Cursorposition wurde kein Symbol gefunden.`
- **fr (修复为)**: `Aucun symbole trouvé au niveau du curseur.`
- **ru (修复为)**: `В позиции курсора символ не найден.`
- **ar (修复为)**: `لم يتم العثور على رمز عند موضع المؤشر.`

### `codeEditor.referencesFound`
- **zh-CN (基准)**: `找到 {symbol} 的 {count} 个引用。`
- **en (参考)**: `References found for {symbol}: {count}.`
- **ja (修复为)**: `{symbol} の参照が {count} 件見つかりました。`
- **es (修复为)**: `Referencias encontradas para {symbol}: {count}.`
- **pt (修复为)**: `Referências encontradas para {symbol}: {count}.`
- **de (修复为)**: `Gefundene Referenzen für {symbol}: {count}.`
- **fr (修复为)**: `Références trouvées pour {symbol} : {count}.`
- **ru (修复为)**: `Найдено ссылок для {symbol}: {count}.`
- **ar (修复为)**: `عدد المراجع التي تم العثور عليها لـ {symbol}: {count}.`

### `codeEditor.lineColumn`
- **zh-CN (基准)**: `行 {line}，列 {column}`
- **en (参考)**: `Ln {line}, Col {column}`
- **ja (修复为)**: `行 {line}、列 {column}`
- **es (修复为)**: `Lín. {line}, Col. {column}`
- **pt (修复为)**: `Lin. {line}, Col. {column}`
- **de (修复为)**: `Z. {line}, Sp. {column}`
- **fr (修复为)**: `Lig. {line}, Col. {column}`
- **ru (修复为)**: `Стр. {line}, Стлб. {column}`
- **ar (修复为)**: `السطر {line}، العمود {column}`

### `codeEditor.spaces`
- **zh-CN (基准)**: `空格: {count}`
- **en (参考)**: `Spaces: {count}`
- **ja (修复为)**: `スペース: {count}`
- **es (修复为)**: `Espacios: {count}`
- **pt (修复为)**: `Espaços: {count}`
- **de (修复为)**: `Leerzeichen: {count}`
- **fr (修复为)**: `Espaces : {count}`
- **ru (修复为)**: `Пробелы: {count}`
- **ar (修复为)**: `المسافات: {count}`

### `codeEditor.inlinePlaceholder`
- **zh-CN (基准)**: `询问或修改所选代码...`
- **en (参考)**: `Ask about or change the selected code...`
- **ja (修复为)**: `選択したコードについて質問または変更...`
- **es (修复为)**: `Pregunta o modifica el código seleccionado...`
- **pt (修复为)**: `Pergunte sobre ou altere o código selecionado...`
- **de (修复为)**: `Fragen zum ausgewählten Code stellen oder ihn bearbeiten...`
- **fr (修复为)**: `Poser une question ou modifier le code sélectionné...`
- **ru (修复为)**: `Задать вопрос или изменить выделенный код...`
- **ar (修复为)**: `اسأل عن التعليمات البرمجية المحددة أو قم بتعديلها...`

### `codeEditor.sendToChat`
- **zh-CN (基准)**: `发送到聊天`
- **en (参考)**: `Send to Chat`
- **ja (修复为)**: `チャットに送信`
- **es (修复为)**: `Enviar al chat`
- **pt (修复为)**: `Enviar para o chat`
- **de (修复为)**: `An Chat senden`
- **fr (修复为)**: `Envoyer au chat`
- **ru (修复为)**: `Отправить в чат`
- **ar (修复为)**: `إرسال إلى الدردشة`

### `codeEditor.cancel`
- **zh-CN (基准)**: `取消`
- **en (参考)**: `Cancel`
- **ja (修复为)**: `キャンセル`
- **es (修复为)**: `Cancelar`
- **pt (修复为)**: `Cancelar`
- **de (修复为)**: `Abbrechen`
- **fr (修复为)**: `Annuler`
- **ru (修复为)**: `Отмена`
- **ar (修复为)**: `إلغاء`

### `codeEditor.selectAgentFirst`
- **zh-CN (基准)**: `请先选择一个 Agent，再将代码发送到聊天。`
- **en (参考)**: `Select an Agent before sending code to chat.`
- **ja (修复为)**: `コードをチャットに送信する前に Agent を選択してください。`
- **es (修复为)**: `Selecciona un Agent antes de enviar el código al chat.`
- **pt (修复为)**: `Selecione um Agent antes de enviar o código para o chat.`
- **de (修复为)**: `Wählen Sie einen Agenten aus, bevor Sie Code an den Chat senden.`
- **fr (修复为)**: `Sélectionnez un Agent avant d’envoyer du code au chat.`
- **ru (修复为)**: `Выберите Agent перед отправкой кода в чат.`
- **ar (修复为)**: `حدد Agent قبل إرسال التعليمات البرمجية إلى الدردشة.`

### `codeEditor.addedToChat`
- **zh-CN (基准)**: `代码已添加到 Agent 聊天草稿。`
- **en (参考)**: `Code was added to the Agent chat draft.`
- **ja (修复为)**: `コードが Agent のチャット下書きに追加されました。`
- **es (修复为)**: `El código se agregó al borrador del chat del Agent.`
- **pt (修复为)**: `O código foi adicionado ao rascunho de chat do Agent.`
- **de (修复为)**: `Code wurde zum Chat-Entwurf des Agenten hinzugefügt.`
- **fr (修复为)**: `Le code a été ajouté au brouillon de chat de l’Agent.`
- **ru (修复为)**: `Код добавлен в черновик чата Agent.`
- **ar (修复为)**: `تمت إضافة التعليمات البرمجية إلى مسودة دردشة Agent.`

### `codeEditor.explainPrompt`
- **zh-CN (基准)**: `请清晰说明这段代码的行为、关键逻辑和重要边界情况。`
- **en (参考)**: `Explain this code clearly, including its behavior and important edge cases.`
- **ja (修复为)**: `このコードの動作、主要なロジック、および重要なエッジケースをわかりやすく説明してください。`
- **es (修复为)**: `Explica este código con claridad, incluyendo su comportamiento, lógica clave y casos límite importantes.`
- **pt (修复为)**: `Explique este código com clareza, incluindo seu comportamento, lógica principal e casos extremos importantes.`
- **de (修复为)**: `Erklären Sie diesen Code klar und verständlich, einschließlich seines Verhaltens, der Kernlogik und wichtiger Randfälle.`
- **fr (修复为)**: `Expliquez clairement ce code, y compris son comportement, sa logique clé et les cas limites importants.`
- **ru (修复为)**: `Чётко объясните работу этого кода, ключевую логику и важные граничные случаи.`
- **ar (修复为)**: `يرجى شرح هذا الكود بوضوح، بما في ذلك سلوكه ومنطقه الأساسي والحالات الحدية المهمة.`

### `codeEditor.reviewPrompt`
- **zh-CN (基准)**: `请从正确性、安全性、性能和可维护性方面评审这段代码。`
- **en (参考)**: `Review this code for correctness, security, performance, and maintainability.`
- **ja (修复为)**: `正確性、セキュリティ、パフォーマンス、保守性の観点からこのコードをレビューしてください。`
- **es (修复为)**: `Revisa este código en cuanto a corrección, seguridad, rendimiento y mantenibilidad.`
- **pt (修复为)**: `Revise este código quanto à correção, segurança, desempenho e manutenibilidade.`
- **de (修复为)**: `Überprüfen Sie diesen Code auf Korrektheit, Sicherheit, Leistung und Wartbarkeit.`
- **fr (修复为)**: `Examinez ce code sous les angles de l’exactitude, de la sécurité, des performances et de la maintenabilité.`
- **ru (修复为)**: `Проверьте этот код на корректность, безопасность, производительность и удобство поддержки.`
- **ar (修复为)**: `يرجى مراجعة هذا الكود من حيث الصحة والأمان والأداء وقابلية الصيانة.`

### `codeEditor.inlinePrompt`
- **zh-CN (基准)**: `请协助处理这段代码：{instruction}`
- **en (参考)**: `Help with this code: {instruction}`
- **ja (修复为)**: `このコードの処理を支援してください: {instruction}`
- **es (修复为)**: `Ayuda con este código: {instruction}`
- **pt (修复为)**: `Ajude com este código: {instruction}`
- **de (修复为)**: `Helfen Sie bei diesem Code: {instruction}`
- **fr (修复为)**: `Aidez avec ce code : {instruction}`
- **ru (修复为)**: `Помогите с этим кодом: {instruction}`
- **ar (修复为)**: `يرجى المساعدة في هذا الكود: {instruction}`

### `codeEditor.startDebug`
- **zh-CN (基准)**: `调试`
- **en (参考)**: `Debug`
- **ja (修复为)**: `デバッグ`
- **es (修复为)**: `Depurar`
- **pt (修复为)**: `Depurar`
- **de (修复为)**: `Debuggen`
- **fr (修复为)**: `Déboguer`
- **ru (修复为)**: `Отладка`
- **ar (修复为)**: `تصحيح`

### `codeEditor.debugStarting`
- **zh-CN (基准)**: `正在启动调试会话...`
- **en (参考)**: `Starting debug session...`
- **ja (修复为)**: `デバッグセッションを開始しています...`
- **es (修复为)**: `Iniciando sesión de depuración...`
- **pt (修复为)**: `Iniciando sessão de depuração...`
- **de (修复为)**: `Debugsitzung wird gestartet...`
- **fr (修复为)**: `Démarrage de la session de débogage...`
- **ru (修复为)**: `Запуск сеанса отладки...`
- **ar (修复为)**: `جارٍ بدء جلسة التصحيح...`

### `codeEditor.debugRunning`
- **zh-CN (基准)**: `正在调试`
- **en (参考)**: `Debugging`
- **ja (修复为)**: `デバッグ中`
- **es (修复为)**: `Depurando`
- **pt (修复为)**: `Depurando`
- **de (修复为)**: `Wird debuggt`
- **fr (修复为)**: `Débogage en cours`
- **ru (修复为)**: `Отладка`
- **ar (修复为)**: `جارٍ التصحيح`

### `codeEditor.debugPaused`
- **zh-CN (基准)**: `已暂停`
- **en (参考)**: `Paused`
- **ja (修复为)**: `一時停止`
- **es (修复为)**: `En pausa`
- **pt (修复为)**: `Pausado`
- **de (修复为)**: `Pausiert`
- **fr (修复为)**: `En pause`
- **ru (修复为)**: `Приостановлено`
- **ar (修复为)**: `متوقف مؤقتًا`

### `codeEditor.continueDebug`
- **zh-CN (基准)**: `继续`
- **en (参考)**: `Continue`
- **ja (修复为)**: `続行`
- **es (修复为)**: `Continuar`
- **pt (修复为)**: `Continuar`
- **de (修复为)**: `Fortsetzen`
- **fr (修复为)**: `Continuer`
- **ru (修复为)**: `Продолжить`
- **ar (修复为)**: `متابعة`

### `codeEditor.stepOver`
- **zh-CN (基准)**: `单步跳过`
- **en (参考)**: `Step Over`
- **ja (修复为)**: `ステップオーバー`
- **es (修复为)**: `Paso a paso por procedimientos`
- **pt (修复为)**: `Contornar`
- **de (修复为)**: `Prozedurschritt`
- **fr (修复为)**: `Pas à pas principal`
- **ru (修复为)**: `Шаг с обходом`
- **ar (修复为)**: `تجاوز الدالة`

### `codeEditor.stepInto`
- **zh-CN (基准)**: `单步进入`
- **en (参考)**: `Step Into`
- **ja (修复为)**: `ステップイン`
- **es (修复为)**: `Paso a paso por instrucciones`
- **pt (修复为)**: `Intervir`
- **de (修复为)**: `Einzelschritt`
- **fr (修复为)**: `Pas à pas détaillé`
- **ru (修复为)**: `Шаг с заходом`
- **ar (修复为)**: `الدخول إلى الدالة`

### `codeEditor.stepOut`
- **zh-CN (基准)**: `单步跳出`
- **en (参考)**: `Step Out`
- **ja (修复为)**: `ステップアウト`
- **es (修复为)**: `Salir de la depuración`
- **pt (修复为)**: `Sair`
- **de (修复为)**: `Rücksprung`
- **fr (修复为)**: `Pas à pas sortant`
- **ru (修复为)**: `Шаг с выходом`
- **ar (修复为)**: `الخروج من الدالة`

### `codeEditor.restartDebug`
- **zh-CN (基准)**: `重启`
- **en (参考)**: `Restart`
- **ja (修复为)**: `再起動`
- **es (修复为)**: `Reiniciar`
- **pt (修复为)**: `Reiniciar`
- **de (修复为)**: `Neu starten`
- **fr (修复为)**: `Redémarrer`
- **ru (修复为)**: `Перезапустить`
- **ar (修复为)**: `إعادة التشغيل`

### `codeEditor.stopDebug`
- **zh-CN (基准)**: `停止`
- **en (参考)**: `Stop`
- **ja (修复为)**: `停止`
- **es (修复为)**: `Detener`
- **pt (修复为)**: `Parar`
- **de (修复为)**: `Stoppen`
- **fr (修复为)**: `Arrêter`
- **ru (修复为)**: `Остановить`
- **ar (修复为)**: `إيقاف`

### `codeEditor.debugUnsupported`
- **zh-CN (基准)**: `此文件类型不支持调试。`
- **en (参考)**: `Debugging is not supported for this file type.`
- **ja (修复为)**: `このファイル形式はデバッグに対応していません。`
- **es (修复为)**: `La depuración no es compatible con este tipo de archivo.`
- **pt (修复为)**: `A depuração não é suportada para este tipo de arquivo.`
- **de (修复为)**: `Debugging wird für diesen Dateityp nicht unterstützt.`
- **fr (修复为)**: `Le débogage n’est pas pris en charge pour ce type de fichier.`
- **ru (修复为)**: `Отладка для этого типа файлов не поддерживается.`
- **ar (修复为)**: `التصحيح غير مدعوم لنوع الملف هذا.`

### `codeEditor.debugStartFailed`
- **zh-CN (基准)**: `无法启动调试会话。`
- **en (参考)**: `Could not start the debug session.`
- **ja (修复为)**: `デバッグセッションを開始できませんでした。`
- **es (修复为)**: `No se pudo iniciar la sesión de depuración.`
- **pt (修复为)**: `Não foi possível iniciar a sessão de depuração.`
- **de (修复为)**: `Die Debugsitzung konnte nicht gestartet werden.`
- **fr (修复为)**: `Impossible de démarrer la session de débogage.`
- **ru (修复为)**: `Не удалось запустить сеанс отладки.`
- **ar (修复为)**: `تعذر بدء جلسة التصحيح.`

### `codeEditor.debugSessionEnded`
- **zh-CN (基准)**: `调试会话已结束。`
- **en (参考)**: `Debug session ended.`
- **ja (修复为)**: `デバッグセッションが終了しました。`
- **es (修复为)**: `La sesión de depuración ha finalizado.`
- **pt (修复为)**: `A sessão de depuração foi encerrada.`
- **de (修复为)**: `Debugsitzung beendet.`
- **fr (修复为)**: `Session de débogage terminée.`
- **ru (修复为)**: `Сеанс отладки завершён.`
- **ar (修复为)**: `انتهت جلسة التصحيح.`

---

## 3. 第二部分：bottomPanel 模块 7 语翻译补全

修改目标文件：`src/lib/i18n/locales/{ja,es,pt,de,fr,ru,ar}.ts`
对象路径：`export const <lang>: Translation = { ... bottomPanel: { ... } }`

以下为各语言的标准修复字典：

### `bottomPanel.problems`
- **zh-CN (基准)**: `问题`
- **en (参考)**: `Problems`
- **ja (修复为)**: `問題`
- **es (修复为)**: `Problemas`
- **pt (修复为)**: `Problemas`
- **de (修复为)**: `Probleme`
- **fr (修复为)**: `Problèmes`
- **ru (修复为)**: `Проблемы`
- **ar (修复为)**: `المشاكل`

### `bottomPanel.output`
- **zh-CN (基准)**: `输出`
- **en (参考)**: `Output`
- **ja (修复为)**: `出力`
- **es (修复为)**: `Salida`
- **pt (修复为)**: `Saída`
- **de (修复为)**: `Ausgabe`
- **fr (修复为)**: `Sortie`
- **ru (修复为)**: `Вывод`
- **ar (修复为)**: `المخرجات`

### `bottomPanel.debugConsole`
- **zh-CN (基准)**: `调试控制台`
- **en (参考)**: `Debug Console`
- **ja (修复为)**: `デバッグコンソール`
- **es (修复为)**: `Consola de depuración`
- **pt (修复为)**: `Console de depuração`
- **de (修复为)**: `Debug-Konsole`
- **fr (修复为)**: `Console de débogage`
- **ru (修复为)**: `Консоль отладки`
- **ar (修复为)**: `وحدة تحكم التصحيح`

### `bottomPanel.terminal`
- **zh-CN (基准)**: `终端`
- **en (参考)**: `Terminal`
- **ja (修复为)**: `ターミナル`
- **es (修复为)**: `Terminal`
- **pt (修复为)**: `Terminal`
- **de (修复为)**: `Terminal`
- **fr (修复为)**: `Terminal`
- **ru (修复为)**: `Терминал`
- **ar (修复为)**: `الطرفية`

### `bottomPanel.references`
- **zh-CN (基准)**: `引用`
- **en (参考)**: `References`
- **ja (修复为)**: `参照`
- **es (修复为)**: `Referencias`
- **pt (修复为)**: `Referências`
- **de (修复为)**: `Referenzen`
- **fr (修复为)**: `Références`
- **ru (修复为)**: `Ссылки`
- **ar (修复为)**: `المراجع`

### `bottomPanel.clearOutput`
- **zh-CN (基准)**: `清空输出`
- **en (参考)**: `Clear output`
- **ja (修复为)**: `出力をクリア`
- **es (修复为)**: `Borrar salida`
- **pt (修复为)**: `Limpar saída`
- **de (修复为)**: `Ausgabe löschen`
- **fr (修复为)**: `Effacer la sortie`
- **ru (修复为)**: `Очистить вывод`
- **ar (修复为)**: `مسح المخرجات`

### `bottomPanel.copyOutput`
- **zh-CN (基准)**: `复制输出`
- **en (参考)**: `Copy output`
- **ja (修复为)**: `出力をコピー`
- **es (修复为)**: `Copiar salida`
- **pt (修复为)**: `Copiar saída`
- **de (修复为)**: `Ausgabe kopieren`
- **fr (修复为)**: `Copier la sortie`
- **ru (修复为)**: `Копировать вывод`
- **ar (修复为)**: `نسخ المخرجات`

### `bottomPanel.clearConsole`
- **zh-CN (基准)**: `清空控制台`
- **en (参考)**: `Clear console`
- **ja (修复为)**: `コンソールをクリア`
- **es (修复为)**: `Borrar consola`
- **pt (修复为)**: `Limpar console`
- **de (修复为)**: `Konsole löschen`
- **fr (修复为)**: `Effacer la console`
- **ru (修复为)**: `Очистить консоль`
- **ar (修复为)**: `مسح وحدة التحكم`

### `bottomPanel.clearReferences`
- **zh-CN (基准)**: `清空引用`
- **en (参考)**: `Clear references`
- **ja (修复为)**: `参照をクリア`
- **es (修复为)**: `Borrar referencias`
- **pt (修复为)**: `Limpar referências`
- **de (修复为)**: `Referenzen löschen`
- **fr (修复为)**: `Effacer les références`
- **ru (修复为)**: `Очистить ссылки`
- **ar (修复为)**: `مسح المراجع`

### `bottomPanel.killTerminal`
- **zh-CN (基准)**: `终止终端`
- **en (参考)**: `Kill terminal`
- **ja (修复为)**: `ターミナルを強制終了`
- **es (修复为)**: `Terminar terminal`
- **pt (修复为)**: `Finalizar terminal`
- **de (修复为)**: `Terminal beenden`
- **fr (修复为)**: `Arrêter le terminal`
- **ru (修复为)**: `Завершить терминал`
- **ar (修复为)**: `إنهاء الطرفية`

### `bottomPanel.closePanel`
- **zh-CN (基准)**: `关闭面板`
- **en (参考)**: `Close panel`
- **ja (修复为)**: `パネルを閉じる`
- **es (修复为)**: `Cerrar panel`
- **pt (修复为)**: `Fechar painel`
- **de (修复为)**: `Bereich schließen`
- **fr (修复为)**: `Fermer le panneau`
- **ru (修复为)**: `Закрыть панель`
- **ar (修复为)**: `إغلاق اللوحة`

### `bottomPanel.noOutput`
- **zh-CN (基准)**: `运行当前文件后将在此处显示输出。`
- **en (参考)**: `Run the current file to see output.`
- **ja (修复为)**: `現在のファイルを実行すると、ここに出力が表示されます。`
- **es (修复为)**: `Ejecuta el archivo actual para ver la salida aquí.`
- **pt (修复为)**: `Execute o arquivo atual para ver a saída aqui.`
- **de (修复为)**: `Führen Sie die aktuelle Datei aus, um die Ausgabe hier zu sehen.`
- **fr (修复为)**: `Exécutez le fichier actuel pour voir la sortie ici.`
- **ru (修复为)**: `Запустите текущий файл, чтобы увидеть вывод.`
- **ar (修复为)**: `شغّل الملف الحالي لرؤية المخرجات هنا.`

### `bottomPanel.noReferences`
- **zh-CN (基准)**: `没有找到引用。`
- **en (参考)**: `No references found.`
- **ja (修复为)**: `参照が見つかりませんでした。`
- **es (修复为)**: `No se encontraron referencias.`
- **pt (修复为)**: `Nenhuma referência encontrada.`
- **de (修复为)**: `Keine Referenzen gefunden.`
- **fr (修复为)**: `Aucune référence trouvée.`
- **ru (修复为)**: `Ссылки не найдены.`
- **ar (修复为)**: `لم يتم العثور على مراجع.`

### `bottomPanel.referencesHint`
- **zh-CN (基准)**: `共找到 {count} 个引用`
- **en (参考)**: `References found: {count}`
- **ja (修复为)**: `合計 {count} 件の参照が見つかりました`
- **es (修复为)**: `Referencias encontradas: {count}`
- **pt (修复为)**: `Referências encontradas: {count}`
- **de (修复为)**: `Gefundene Referenzen: {count}`
- **fr (修复为)**: `Références trouvées : {count}`
- **ru (修复为)**: `Всего найдено ссылок: {count}`
- **ar (修复为)**: `عدد المراجع التي تم العثور عليها: {count}`

### `bottomPanel.loading`
- **zh-CN (基准)**: `正在加载...`
- **en (参考)**: `Loading...`
- **ja (修复为)**: `読み込み中...`
- **es (修复为)**: `Cargando...`
- **pt (修复为)**: `Carregando...`
- **de (修复为)**: `Wird geladen...`
- **fr (修复为)**: `Chargement...`
- **ru (修复为)**: `Загрузка...`
- **ar (修复为)**: `جارٍ التحميل...`

### `bottomPanel.problemsNone`
- **zh-CN (基准)**: `未检测到任何问题。`
- **en (参考)**: `No problems have been detected.`
- **ja (修复为)**: `問題は検出されませんでした。`
- **es (修复为)**: `No se ha detectado ningún problema.`
- **pt (修复为)**: `Nenhum problema detectado.`
- **de (修复为)**: `Es wurden keine Probleme festgestellt.`
- **fr (修复为)**: `Aucun problème détecté.`
- **ru (修复为)**: `Проблем не обнаружено.`
- **ar (修复为)**: `لم يتم اكتشاف أي مشاكل.`

### `bottomPanel.debugNotRunning`
- **zh-CN (基准)**: `未在调试`
- **en (参考)**: `Not debugging`
- **ja (修复为)**: `デバッグしていません`
- **es (修复为)**: `No se está depurando`
- **pt (修复为)**: `Não está depurando`
- **de (修复为)**: `Keine aktive Debugsitzung`
- **fr (修复为)**: `Pas de débogage en cours`
- **ru (修复为)**: `Отладка не запущена`
- **ar (修复为)**: `التصحيح غير نشط`

### `bottomPanel.debugStartHint`
- **zh-CN (基准)**: `按 F5 开始调试`
- **en (参考)**: `Press F5 to start debugging`
- **ja (修复为)**: `F5 キーを押してデバッグを開始`
- **es (修复为)**: `Pulsa F5 para iniciar la depuración`
- **pt (修复为)**: `Pressione F5 para iniciar a depuração`
- **de (修复为)**: `F5 drücken, um das Debugging zu starten`
- **fr (修复为)**: `Appuyez sur F5 pour démarrer le débogage`
- **ru (修复为)**: `Нажмите F5, чтобы начать отладку`
- **ar (修复为)**: `اضغط على F5 لبدء التصحيح`

### `bottomPanel.variables`
- **zh-CN (基准)**: `变量`
- **en (参考)**: `Variables`
- **ja (修复为)**: `変数`
- **es (修复为)**: `Variables`
- **pt (修复为)**: `Variáveis`
- **de (修复为)**: `Variablen`
- **fr (修复为)**: `Variables`
- **ru (修复为)**: `Переменные`
- **ar (修复为)**: `المتغيرات`

### `bottomPanel.callStack`
- **zh-CN (基准)**: `调用堆栈`
- **en (参考)**: `Call Stack`
- **ja (修复为)**: `コールスタック`
- **es (修复为)**: `Pila de llamadas`
- **pt (修复为)**: `Pilha de chamadas`
- **de (修复为)**: `Aufrufliste`
- **fr (修复为)**: `Pile des appels`
- **ru (修复为)**: `Стек вызовов`
- **ar (修复为)**: `مكدس الاستدعاءات`

### `bottomPanel.breakpoints`
- **zh-CN (基准)**: `断点`
- **en (参考)**: `Breakpoints`
- **ja (修复为)**: `ブレークポイント`
- **es (修复为)**: `Puntos de interrupción`
- **pt (修复为)**: `Pontos de interrupção`
- **de (修复为)**: `Haltepunkte`
- **fr (修复为)**: `Points d’arrêt`
- **ru (修复为)**: `Точки останова`
- **ar (修复为)**: `نقاط التوقف`

### `bottomPanel.noVariables`
- **zh-CN (基准)**: `没有可用变量`
- **en (参考)**: `No variables available`
- **ja (修复为)**: `利用可能な変数はありません`
- **es (修复为)**: `No hay variables disponibles`
- **pt (修复为)**: `Nenhuma variável disponível`
- **de (修复为)**: `Keine Variablen verfügbar`
- **fr (修复为)**: `Aucune variable disponible`
- **ru (修复为)**: `Нет доступных переменных`
- **ar (修复为)**: `لا توجد متغيرات متاحة`

### `bottomPanel.noFrames`
- **zh-CN (基准)**: `没有调用帧`
- **en (参考)**: `No stack frames`
- **ja (修复为)**: `呼び出しフレームはありません`
- **es (修复为)**: `No hay marcos de pila`
- **pt (修复为)**: `Nenhum quadro de pilha`
- **de (修复为)**: `Keine Stapelrahmen`
- **fr (修复为)**: `Aucun frame de pile`
- **ru (修复为)**: `Нет кадров стека`
- **ar (修复为)**: `لا توجد إطارات في مكدس الاستدعاءات`

### `bottomPanel.noBreakpoints`
- **zh-CN (基准)**: `没有断点`
- **en (参考)**: `No breakpoints`
- **ja (修复为)**: `ブレークポイントはありません`
- **es (修复为)**: `No hay puntos de interrupción`
- **pt (修复为)**: `Nenhum ponto de interrupção`
- **de (修复为)**: `Keine Haltepunkte`
- **fr (修复为)**: `Aucun point d’arrêt`
- **ru (修复为)**: `Нет точек останова`
- **ar (修复为)**: `لا توجد نقاط توقف`

### `bottomPanel.debugConsoleEmpty`
- **zh-CN (基准)**: `开始调试后，程序输出将显示在此处。`
- **en (参考)**: `Program output will appear here while debugging.`
- **ja (修复为)**: `デバッグを開始すると、プログラムの出力がここに表示されます。`
- **es (修复为)**: `La salida del programa aparecerá aquí durante la depuración.`
- **pt (修复为)**: `A saída do programa aparecerá aqui durante a depuração.`
- **de (修复为)**: `Die Programmausgabe wird während des Debuggens hier angezeigt.`
- **fr (修复为)**: `La sortie du programme apparaîtra ici pendant le débogage.`
- **ru (修复为)**: `Вывод программы будет отображаться здесь во время отладки.`
- **ar (修复为)**: `ستظهر مخرجات البرنامج هنا أثناء التصحيح.`

### `bottomPanel.debugConsoleIdle`
- **zh-CN (基准)**: `调试会话未运行`
- **en (参考)**: `The debug session is not running`
- **ja (修复为)**: `デバッグセッションは実行されていません`
- **es (修复为)**: `La sesión de depuración no se está ejecutando`
- **pt (修复为)**: `A sessão de depuração não está em execução`
- **de (修复为)**: `Die Debugsitzung wird nicht ausgeführt`
- **fr (修复为)**: `La session de débogage n’est pas en cours d’exécution`
- **ru (修复为)**: `Сеанс отладки не запущен`
- **ar (修复为)**: `جلسة التصحيح غير قيد التشغيل`

### `bottomPanel.debugConsolePlaceholder`
- **zh-CN (基准)**: `输入表达式并按 Enter 求值`
- **en (参考)**: `Type an expression and press Enter to evaluate`
- **ja (修复为)**: `式を入力し、Enter キーを押して評価します`
- **es (修复为)**: `Escribe una expresión y pulsa Enter para evaluar`
- **pt (修复为)**: `Digite uma expressão e pressione Enter para avaliar`
- **de (修复为)**: `Ausdruck eingeben und mit Enter auswerten`
- **fr (修复为)**: `Saisissez une expression et appuyez sur Entrée pour évaluer`
- **ru (修复为)**: `Введите выражение и нажмите Enter для вычисления`
- **ar (修复为)**: `اكتب تعبيرًا واضغط على Enter للتقييم`

### `bottomPanel.terminalEmpty`
- **zh-CN (基准)**: `输入命令即可开始使用终端。`
- **en (参考)**: `Type a command to start using the terminal.`
- **ja (修复为)**: `コマンドを入力してターミナルの使用を開始します。`
- **es (修复为)**: `Escribe un comando para empezar a usar la terminal.`
- **pt (修复为)**: `Digite um comando para começar a usar o terminal.`
- **de (修复为)**: `Geben Sie einen Befehl ein, um das Terminal zu verwenden.`
- **fr (修复为)**: `Saisissez une commande pour commencer à utiliser le terminal.`
- **ru (修复为)**: `Введите команду, чтобы начать работу с терминалом.`
- **ar (修复为)**: `اكتب أمرًا لبدء استخدام الطرفية.`

### `bottomPanel.terminalPlaceholder`
- **zh-CN (基准)**: `输入命令...`
- **en (参考)**: `Type a command...`
- **ja (修复为)**: `コマンドを入力...`
- **es (修复为)**: `Escribe un comando...`
- **pt (修复为)**: `Digite um comando...`
- **de (修复为)**: `Befehl eingeben...`
- **fr (修复为)**: `Saisissez une commande...`
- **ru (修复为)**: `Введите команду...`
- **ar (修复为)**: `اكتب أمرًا...`

### `bottomPanel.terminalExited`
- **zh-CN (基准)**: `终端进程已退出`
- **en (参考)**: `Terminal process exited`
- **ja (修复为)**: `ターミナルプロセスが終了しました`
- **es (修复为)**: `El proceso del terminal ha finalizado`
- **pt (修复为)**: `O processo do terminal foi encerrado`
- **de (修复为)**: `Terminalprozess beendet`
- **fr (修复为)**: `Le processus du terminal s’est terminé`
- **ru (修复为)**: `Процесс терминала завершён`
- **ar (修复为)**: `انتهت عملية الطرفية`

---

## 4. 第三部分：fileHandler 模块代码文件未翻译修复

修改目标文件：`src/lib/i18n/locales/{ja,es,pt,de,fr,ru,ar}.ts`
对象路径：`fileHandler.codeDocuments`

- **zh-CN (基准)**: `代码文件`
- **en**: `Code Files`
- **问题说明**: 原文件中在 `ja`, `es`, `pt`, `de`, `fr`, `ru`, `ar` 中直接残留为 `Code Files`。
- **修复方案**:
  - `ja.ts`: `コードファイル`
  - `es.ts`: `Archivos de código`
  - `pt.ts`: `Arquivos de código`
  - `de.ts`: `Codedateien`
  - `fr.ts`: `Fichiers de code`
  - `ru.ts`: `Файлы с кодом`
  - `ar.ts`: `ملفات التعليمات البرمجية`

---

## 5. 第四部分：德语 (de.ts) 术语与词义偏差修正

修改目标文件：`src/lib/i18n/locales/de.ts`

1. **`appShell.browse`**
   - **中文基准**: `浏览`
   - **当前德语**: `Ordner` (错误：名词“文件夹”)
   - **应修改为**: `Durchsuchen`

2. **`notepad.goToAction`**
   - **中文基准**: `转到` (行号跳转弹窗中的按钮动作)
   - **当前德语**: `Los` (口语“出发/走起”)
   - **应修改为**: `Gehe zu`

3. **`appShell.homeNoRecent`**
   - **中文基准**: `暂无最近目录`
   - **当前德语**: `Keine letzten Ordner` (生硬)
   - **应修改为**: `Keine zuletzt geöffneten Ordner`

---

## 6. 第五部分：阿拉伯语 (ar.ts) 术语一致性修正

修改目标文件：`src/lib/i18n/locales/ar.ts`

1. **`agentOrchestrator.agentUnavailable`**
   - **中文基准**: `请求的 Agent 不可用或已停用`
   - **当前阿语**: `الوكيل المطلوب غير متاح أو معطّل` (错误：突然将保留专有名词 Agent 直译为普通名词 الوكيل)
   - **应修改为**: `الـ Agent المطلوب غير متاح أو معطّل`

2. **`excelEditor.closeDialog` 与 `excelEditor.excelDialog`**
   - **中文基准**: `关闭对话框` / `Excel 对话框`
   - **当前阿语**: `إغلاق الحوار` / `حوار Excel`
   - **应修改为**: `إغلاق مربع الحوار` / `مربع حوار Excel`

---

## 7. 第六部分：巴西葡萄牙语 (pt.ts) 术语一致性修正

修改目标文件：`src/lib/i18n/locales/pt.ts`

1. **`notepad.lineColumn`**
   - **中文基准**: `行 {line}，列 {column}`
   - **当前巴西葡语**: `Ln {line}, Col {column}` (使用了英文缩写 Ln)
   - **应修改为**: `Lin. {line}, Col. {column}`

2. **`excelEditor.cannotLoad` / `cannotLoadGeneric` / `loading`**
   - **中文基准**: `工作簿`
   - **当前巴西葡语**: `planilha` (意为“工作表/电子表格”，与工作簿 Workbook 混淆)
   - **应修改为**:
     - `excelEditor.cannotLoad`: `Não foi possível carregar a pasta de trabalho: {error}`
     - `excelEditor.cannotLoadGeneric`: `Não foi possível carregar a pasta de trabalho.`
     - `excelEditor.loading`: `Carregando pasta de trabalho...`

---

## 8. 第七部分：记事本模块 (notepad) 动词遗漏与条件补充

在 `ja.ts`, `es.ts`, `pt.ts`, `de.ts`, `fr.ts`, `ru.ts`, `ar.ts` 中修正以下键：

1. **`notepad.openInNewTab`**
   - **中文基准**: `在新标签页中打开`
   - **当前问题**: 仅为名词短语（如 `新しいタブ` / `Nueva pestaña` / `Neue Registerkarte`），遗漏动词“打开”。
   - **修复建议**:
     - `ja.ts`: `新しいタブで開く`
     - `es.ts`: `Abrir en una pestaña nueva`
     - `pt.ts`: `Abrir em uma nova guia`
     - `de.ts`: `In neuer Registerkarte öffnen`
     - `fr.ts`: `Ouvrir dans un nouvel onglet`
     - `ru.ts`: `Открыть в новой вкладке`
     - `ar.ts`: `فتح في علامة تبويب جديدة`

2. **`notepad.openInNewWindow`**
   - **中文基准**: `在新窗口中打开`
   - **修复建议**:
     - `ja.ts`: `新しいウィンドウで開く`
     - `es.ts`: `Abrir en una ventana nueva`
     - `pt.ts`: `Abrir em uma nova janela`
     - `de.ts`: `In neuem Fenster öffnen`
     - `fr.ts`: `Ouvrir dans une nouvelle fenêtre`
     - `ru.ts`: `Открыть в новом окне`
     - `ar.ts`: `فتح في نافذة جديدة`

3. **`notepad.autoCorrectDescription`**
   - **中文基准**: `打开拼写检查时，将自动更正拼写错误。`
   - **当前问题**: 遗漏了“打开拼写检查时”的前提条件。
   - **修复建议**:
     - `ja.ts`: `スペルチェックが有効な場合、入力ミスを自動修正します。`
     - `es.ts`: `Los errores tipográficos se corrigen automáticamente al activar la revisión ortográfica.`
     - `pt.ts`: `Os erros de digitação são corrigidos automaticamente quando a verificação ortográfica está ativada.`
     - `de.ts`: `Tippfehler werden bei aktivierter Rechtschreibprüfung automatisch korrigiert.`
     - `fr.ts`: `Les fautes de frappe sont automatiquement corrigées lorsque la vérification orthographique est activée.`
     - `ru.ts`: `Опечатки исправляются автоматически при включённой проверке орфографии.`
     - `ar.ts`: `يتم تصحيح الأخطاء الإملائية تلقائيًا عند تشغيل التدقيق الإملائي.`

---

## 9. 第八部分：法语 (fr.ts) 印刷排版弯引号规范化

修改目标文件：`src/lib/i18n/locales/fr.ts`
- 只处理翻译运行时文本中位于两个 Unicode 字母之间的省音直撇号 `'`，统一替换为排版弯撇号 `’`，例如 `d'accueil` → `d’accueil`、`l'assistant` → `l’assistant`、`l'emplacement` → `l’emplacement`。
- 不替换 TypeScript 字符串定界符、转义结构、代码片段、文件名引号或其它不属于法语省音的字符。

---

## 10. 快速自动化验收方式

修改完成后，在项目终端依次执行：
```bash
npm run check:i18n
npm run typecheck
npm run verify:i18n-ui
npm run verify:code-editor
```

真实验收标准：

1. `check:i18n` 输出 `i18n check passed: 9 locales, 721 keys per locale.`，所有语言键树、占位符和 UTF-8 检查通过。原计划中的 715 已因工作区现有的 6 个 `agentUi` 历史记录键更新为 721；这 6 个键也必须在 7 个目标语言中完成本地化。
2. 7 个目标语言的 `codeEditor` 与 `bottomPanel` 不得整段复制英文；只允许西班牙语和法语的 `Terminal`、`Variables`，以及巴西葡萄牙语和德语的 `Terminal` 与英文相同。
3. `fileHandler.codeDocuments` 必须完成本地化；本指南列出的关键术语采用精确断言。
4. 法语运行时文本不得含有位于字母之间的直撇号；计数文案必须在 `{count}=0/1/2` 时完整插值，且不残留占位符。
5. 全局 `identicalToEn` 当前参考值为：`ja=14, es=18, pt=23, de=25, fr=30, ru=12, ar=12`。该指标用于最终人工复核品牌名、通用技术词和白名单项，不替代范围内的精确检查。
