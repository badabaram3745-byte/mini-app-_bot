import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { SupportedLocale } from "./locale";

interface TranslationStrings {
  close: string;
  connected: string;
  currentSlide: string;
  download: string;
  downloadFailed: string;
  elapsedTime: string;
  enterFullscreen: string;
  expandedImage: string;
  next: string;
  noNotes: string;
  pdfDocument: string;
  startPresentation: string;
  popupBlocked: string;
  presenter: string;
  preparingDownload: string;
  presentation: string;
  presentationControls: string;
  presenterView: string;
  powerPoint: string;
  previous: string;
  hideThumbnails: string;
  showThumbnails: string;
  slidePosition: string;
  slidePreview: string;
  slides: string;
  speakerNotes: string;
  upNext: string;
  goToSlideNumber: string;
  slideLabel: string;
}

type TranslationMessages = Omit<
  TranslationStrings,
  "goToSlideNumber" | "slideLabel"
> & {
  goToSlideNumber: (slideNumber: number) => string;
  slideLabel: (slideNumber: number, slideCount: number) => string;
};

const translations: Record<SupportedLocale, TranslationStrings> = {
  en: {
    close: "Close",
    connected: "Connected",
    currentSlide: "Current slide",
    download: "Download",
    downloadFailed: "Download failed.",
    elapsedTime: "Elapsed time",
    enterFullscreen: "Enter fullscreen",
    expandedImage: "Expanded image",
    next: "Next",
    noNotes: "No notes for this slide.",
    pdfDocument: "PDF document",
    startPresentation: "Play",
    popupBlocked:
      "The presenter window was blocked. Allow popups and try again.",
    presenter: "Presenter",
    preparingDownload: "Preparing download…",
    presentation: "Presentation",
    presentationControls: "Presentation controls",
    presenterView: "Presenter view",
    powerPoint: "PowerPoint",
    previous: "Previous",
    hideThumbnails: "Hide slide previews",
    showThumbnails: "Show slide previews",
    slidePosition: "Slide position",
    slidePreview: "Slide preview",
    slides: "Slides",
    speakerNotes: "Speaker notes",
    upNext: "Up next",
    goToSlideNumber: "Go to slide {slideNumber}",
    slideLabel: "Slide {slideNumber} of {slideCount}",
  },
  de: {
    close: "Schließen",
    connected: "Verbunden",
    currentSlide: "Aktuelle Folie",
    download: "Herunterladen",
    downloadFailed: "Download fehlgeschlagen.",
    elapsedTime: "Verstrichene Zeit",
    enterFullscreen: "Vollbild aktivieren",
    expandedImage: "Vergrößertes Bild",
    next: "Weiter",
    noNotes: "Keine Notizen für diese Folie.",
    pdfDocument: "PDF-Dokument",
    startPresentation: "Präsentieren",
    popupBlocked:
      "Das Referentenfenster wurde blockiert. Erlauben Sie Pop-ups und versuchen Sie es erneut.",
    presenter: "Referentenansicht",
    preparingDownload: "Download wird vorbereitet…",
    presentation: "Präsentation",
    presentationControls: "Präsentationssteuerung",
    presenterView: "Referentenansicht",
    powerPoint: "PowerPoint",
    previous: "Zurück",
    hideThumbnails: "Folienvorschauen ausblenden",
    showThumbnails: "Folienvorschauen anzeigen",
    slidePosition: "Folienposition",
    slidePreview: "Folienvorschau",
    slides: "Folien",
    speakerNotes: "Sprechernotizen",
    upNext: "Als Nächstes",
    goToSlideNumber: "Zu Folie {slideNumber} wechseln",
    slideLabel: "Folie {slideNumber} von {slideCount}",
  },
  es: {
    close: "Cerrar",
    connected: "Conectado",
    currentSlide: "Diapositiva actual",
    download: "Descargar",
    downloadFailed: "No se pudo completar la descarga.",
    elapsedTime: "Tiempo transcurrido",
    enterFullscreen: "Activar pantalla completa",
    expandedImage: "Imagen ampliada",
    next: "Siguiente",
    noNotes: "No hay notas para esta diapositiva.",
    pdfDocument: "Documento PDF",
    startPresentation: "Presentar",
    popupBlocked:
      "Se bloqueó la ventana del presentador. Permite las ventanas emergentes e inténtalo de nuevo.",
    presenter: "Vista del presentador",
    preparingDownload: "Preparando la descarga…",
    presentation: "Presentación",
    presentationControls: "Controles de presentación",
    presenterView: "Vista del presentador",
    powerPoint: "PowerPoint",
    previous: "Anterior",
    hideThumbnails: "Ocultar vistas previas",
    showThumbnails: "Mostrar vistas previas",
    slidePosition: "Posición de la diapositiva",
    slidePreview: "Vista previa de la diapositiva",
    slides: "Diapositivas",
    speakerNotes: "Notas del orador",
    upNext: "A continuación",
    goToSlideNumber: "Ir a la diapositiva {slideNumber}",
    slideLabel: "Diapositiva {slideNumber} de {slideCount}",
  },
  fr: {
    close: "Fermer",
    connected: "Connecté",
    currentSlide: "Diapositive actuelle",
    download: "Télécharger",
    downloadFailed: "Échec du téléchargement.",
    elapsedTime: "Temps écoulé",
    enterFullscreen: "Activer le plein écran",
    expandedImage: "Image agrandie",
    next: "Suivant",
    noNotes: "Aucune note pour cette diapositive.",
    pdfDocument: "Document PDF",
    startPresentation: "Présenter",
    popupBlocked:
      "La fenêtre du mode Présentateur a été bloquée. Autorisez les fenêtres contextuelles et réessayez.",
    presenter: "Mode Présentateur",
    preparingDownload: "Préparation du téléchargement…",
    presentation: "Présentation",
    presentationControls: "Commandes de présentation",
    presenterView: "Mode Présentateur",
    powerPoint: "PowerPoint",
    previous: "Précédent",
    hideThumbnails: "Masquer les aperçus",
    showThumbnails: "Afficher les aperçus",
    slidePosition: "Position de la diapositive",
    slidePreview: "Aperçu de la diapositive",
    slides: "Diapositives",
    speakerNotes: "Notes du présentateur",
    upNext: "À suivre",
    goToSlideNumber: "Aller à la diapositive {slideNumber}",
    slideLabel: "Diapositive {slideNumber} sur {slideCount}",
  },
  pt: {
    close: "Fechar",
    connected: "Conectado",
    currentSlide: "Slide atual",
    download: "Baixar",
    downloadFailed: "Não foi possível baixar o arquivo.",
    elapsedTime: "Tempo decorrido",
    enterFullscreen: "Entrar em tela cheia",
    expandedImage: "Imagem ampliada",
    next: "Próximo",
    noNotes: "Não há anotações para este slide.",
    pdfDocument: "Documento PDF",
    startPresentation: "Apresentar",
    popupBlocked:
      "A janela do modo do apresentador foi bloqueada. Permita pop-ups e tente novamente.",
    presenter: "Modo do apresentador",
    preparingDownload: "Preparando o download…",
    presentation: "Apresentação",
    presentationControls: "Controles da apresentação",
    presenterView: "Modo do apresentador",
    powerPoint: "PowerPoint",
    previous: "Anterior",
    hideThumbnails: "Ocultar prévias",
    showThumbnails: "Mostrar prévias",
    slidePosition: "Posição do slide",
    slidePreview: "Prévia do slide",
    slides: "Slides",
    speakerNotes: "Anotações do apresentador",
    upNext: "A seguir",
    goToSlideNumber: "Ir para o slide {slideNumber}",
    slideLabel: "Slide {slideNumber} de {slideCount}",
  },
  ja: {
    close: "閉じる",
    connected: "接続済み",
    currentSlide: "現在のスライド",
    download: "ダウンロード",
    downloadFailed: "ダウンロードに失敗しました。",
    elapsedTime: "経過時間",
    enterFullscreen: "全画面表示にする",
    expandedImage: "拡大表示された画像",
    next: "次へ",
    noNotes: "このスライドにはノートがありません。",
    pdfDocument: "PDF ドキュメント",
    startPresentation: "プレゼンテーションを開始",
    popupBlocked:
      "発表者ビューのウィンドウがブロックされました。ポップアップを許可して、もう一度お試しください。",
    presenter: "発表者ビュー",
    preparingDownload: "ダウンロードの準備中…",
    presentation: "プレゼンテーション",
    presentationControls: "プレゼンテーションの操作",
    presenterView: "発表者ビュー",
    powerPoint: "PowerPoint",
    previous: "前へ",
    hideThumbnails: "スライドのプレビューを非表示",
    showThumbnails: "スライドのプレビューを表示",
    slidePosition: "スライド番号",
    slidePreview: "スライドプレビュー",
    slides: "スライド",
    speakerNotes: "発表者ノート",
    upNext: "次の表示内容",
    goToSlideNumber: "{slideNumber}枚目のスライドに移動",
    slideLabel: "全{slideCount}枚中{slideNumber}枚目のスライド",
  },
  ko: {
    close: "닫기",
    connected: "연결됨",
    currentSlide: "현재 슬라이드",
    download: "다운로드",
    downloadFailed: "다운로드하지 못했습니다.",
    elapsedTime: "경과 시간",
    enterFullscreen: "전체 화면으로 전환",
    expandedImage: "확대된 이미지",
    next: "다음",
    noNotes: "이 슬라이드에는 노트가 없습니다.",
    pdfDocument: "PDF 문서",
    startPresentation: "프레젠테이션 시작",
    popupBlocked:
      "발표자 보기 창이 차단되었습니다. 팝업을 허용한 후 다시 시도하세요.",
    presenter: "발표자 보기",
    preparingDownload: "다운로드 준비 중…",
    presentation: "프레젠테이션",
    presentationControls: "프레젠테이션 컨트롤",
    presenterView: "발표자 보기",
    powerPoint: "PowerPoint",
    previous: "이전",
    hideThumbnails: "슬라이드 미리보기 숨기기",
    showThumbnails: "슬라이드 미리보기 표시",
    slidePosition: "슬라이드 번호",
    slidePreview: "슬라이드 미리보기",
    slides: "슬라이드",
    speakerNotes: "발표자 노트",
    upNext: "다음",
    goToSlideNumber: "{slideNumber}번 슬라이드로 이동",
    slideLabel: "전체 {slideCount}장 중 {slideNumber}번째 슬라이드",
  },
  "zh-CN": {
    close: "关闭",
    connected: "已连接",
    currentSlide: "当前幻灯片",
    download: "下载",
    downloadFailed: "下载失败。",
    elapsedTime: "已用时间",
    enterFullscreen: "进入全屏",
    expandedImage: "放大后的图片",
    next: "下一步",
    noNotes: "此幻灯片没有备注。",
    pdfDocument: "PDF 文档",
    startPresentation: "开始放映",
    popupBlocked: "浏览器阻止了演示者视图窗口。请允许弹出式窗口，然后重试。",
    presenter: "演示者视图",
    preparingDownload: "正在准备下载…",
    presentation: "幻灯片放映",
    presentationControls: "幻灯片放映控件",
    presenterView: "演示者视图",
    powerPoint: "PowerPoint",
    previous: "上一步",
    hideThumbnails: "隐藏幻灯片预览",
    showThumbnails: "显示幻灯片预览",
    slidePosition: "幻灯片编号",
    slidePreview: "幻灯片预览",
    slides: "幻灯片",
    speakerNotes: "演讲者备注",
    upNext: "下一步",
    goToSlideNumber: "转到第 {slideNumber} 张幻灯片",
    slideLabel: "第 {slideNumber} 张幻灯片，共 {slideCount} 张",
  },
  "zh-TW": {
    close: "關閉",
    connected: "已連線",
    currentSlide: "目前投影片",
    download: "下載",
    downloadFailed: "下載失敗。",
    elapsedTime: "經過時間",
    enterFullscreen: "進入全螢幕",
    expandedImage: "放大後的圖片",
    next: "下一步",
    noNotes: "此投影片沒有備忘稿。",
    pdfDocument: "PDF 檔案",
    startPresentation: "播放簡報",
    popupBlocked: "瀏覽器封鎖了簡報者檢視視窗。請允許彈出式視窗後再試一次。",
    presenter: "簡報者",
    preparingDownload: "正在準備下載…",
    presentation: "投影片放映",
    presentationControls: "投影片放映控制項",
    presenterView: "簡報者檢視",
    powerPoint: "PowerPoint",
    previous: "上一步",
    hideThumbnails: "隱藏投影片預覽",
    showThumbnails: "顯示投影片預覽",
    slidePosition: "投影片編號",
    slidePreview: "投影片預覽",
    slides: "投影片",
    speakerNotes: "演講者備忘稿",
    upNext: "下一步",
    goToSlideNumber: "移至第 {slideNumber} 張投影片",
    slideLabel: "第 {slideNumber} 張投影片，共 {slideCount} 張",
  },
};

const LocalizationContext = createContext(createMessages(translations.en));

export function LocalizationProvider({
  children,
  locale,
}: {
  children: ReactNode;
  locale: SupportedLocale;
}) {
  const messages = useMemo(
    () => createMessages(translations[locale]),
    [locale],
  );
  return (
    <LocalizationContext.Provider value={messages}>
      {children}
    </LocalizationContext.Provider>
  );
}

export function useLocalization(): TranslationMessages {
  return useContext(LocalizationContext);
}

function createMessages(strings: TranslationStrings): TranslationMessages {
  return {
    ...strings,
    goToSlideNumber: (slideNumber) =>
      formatSlideMessage(strings.goToSlideNumber, slideNumber),
    slideLabel: (slideNumber, slideCount) =>
      formatSlideMessage(strings.slideLabel, slideNumber, slideCount),
  };
}

function formatSlideMessage(
  template: string,
  slideNumber: number,
  slideCount?: number,
): string {
  return template
    .replace("{slideNumber}", String(slideNumber))
    .replace(
      "{slideCount}",
      slideCount === undefined ? "" : String(slideCount),
    );
}
