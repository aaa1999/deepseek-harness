/** Locale-owned copy for experimental voice chat. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Dictionary namespace for every voice-chat control. */
export const NS = 'voice-chat'

/** Chinese dictionary and key source. */
export const zh = {
  call: '语音通话',
  end: '结束通话',
  retry: '重试',
  'phase.ready': '请说话',
  'phase.listening': '聆听中…',
  'phase.transcribing': '识别中…',
  'phase.thinking': '思考中…',
  'phase.speaking': '回复中…',
  'phase.failed': '语音通话出错',
  'setup.trigger': '打开语音通话引导',
} as const

export type VoiceChatKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Experimental voice-chat controls. */
    'voice-chat': VoiceChatKey
  }
}

export const en: Record<VoiceChatKey, string> = {
  call: 'Voice call',
  end: 'End call',
  retry: 'Retry',
  'phase.ready': 'Speak now',
  'phase.listening': 'Listening…',
  'phase.transcribing': 'Transcribing…',
  'phase.thinking': 'Thinking…',
  'phase.speaking': 'Replying…',
  'phase.failed': 'Voice call failed',
  'setup.trigger': 'Open voice call setup',
}

export const ja: Record<VoiceChatKey, string> = {
  call: '音声通話',
  end: '通話終了',
  retry: '再試行',
  'phase.ready': '話してください',
  'phase.listening': '聞き取り中…',
  'phase.transcribing': '文字起こし中…',
  'phase.thinking': '考え中…',
  'phase.speaking': '返答中…',
  'phase.failed': '音声通話エラー',
  'setup.trigger': '音声通話セットアップを開く',
}

export const es: Record<VoiceChatKey, string> = {
  call: 'Llamada de voz',
  end: 'Finalizar llamada',
  retry: 'Reintentar',
  'phase.ready': 'Hable ahora',
  'phase.listening': 'Escuchando…',
  'phase.transcribing': 'Transcribiendo…',
  'phase.thinking': 'Pensando…',
  'phase.speaking': 'Respondiendo…',
  'phase.failed': 'Error en la llamada de voz',
  'setup.trigger': 'Abrir configuración de llamada de voz',
}

export const fr: Record<VoiceChatKey, string> = {
  call: 'Appel vocal',
  end: 'Terminer l’appel',
  retry: 'Réessayer',
  'phase.ready': 'Parlez maintenant',
  'phase.listening': 'Écoute…',
  'phase.transcribing': 'Transcription…',
  'phase.thinking': 'Réflexion…',
  'phase.speaking': 'Réponse…',
  'phase.failed': 'Échec de l’appel vocal',
  'setup.trigger': 'Ouvrir la configuration de l’appel vocal',
}

export const de: Record<VoiceChatKey, string> = {
  call: 'Sprachanruf',
  end: 'Anruf beenden',
  retry: 'Erneut versuchen',
  'phase.ready': 'Jetzt sprechen',
  'phase.listening': 'Höre zu…',
  'phase.transcribing': 'Transkribiere…',
  'phase.thinking': 'Denkt nach…',
  'phase.speaking': 'Antwortet…',
  'phase.failed': 'Sprachanruf fehlgeschlagen',
  'setup.trigger': 'Sprachanruf-Einrichtung öffnen',
}

export const ru: Record<VoiceChatKey, string> = {
  call: 'Голосовой звонок',
  end: 'Завершить звонок',
  retry: 'Повторить',
  'phase.ready': 'Говорите',
  'phase.listening': 'Слушаю…',
  'phase.transcribing': 'Распознаю…',
  'phase.thinking': 'Думаю…',
  'phase.speaking': 'Отвечаю…',
  'phase.failed': 'Ошибка голосового звонка',
  'setup.trigger': 'Открыть настройку голосового звонка',
}

export const pt: Record<VoiceChatKey, string> = {
  call: 'Chamada de voz',
  end: 'Encerrar chamada',
  retry: 'Tentar novamente',
  'phase.ready': 'Fale agora',
  'phase.listening': 'Ouvindo…',
  'phase.transcribing': 'Transcrevendo…',
  'phase.thinking': 'Pensando…',
  'phase.speaking': 'Respondendo…',
  'phase.failed': 'Falha na chamada de voz',
  'setup.trigger': 'Abrir configuração da chamada de voz',
}
