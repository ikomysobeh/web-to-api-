import { useEffect } from "react";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";

export function useSpeechToText(onResult: (text: string) => void) {
  const { transcript, listening, browserSupportsSpeechRecognition, resetTranscript } =
    useSpeechRecognition();

  useEffect(() => {
    if (!listening && transcript) {
      onResult(transcript);
      resetTranscript();
    }
  }, [listening, transcript, onResult, resetTranscript]);

  function toggle() {
    if (listening) {
      SpeechRecognition.stopListening();
    } else {
      resetTranscript();
      void SpeechRecognition.startListening({ continuous: false, language: "en-US" });
    }
  }

  return { listening, supported: !!browserSupportsSpeechRecognition, toggle };
}
