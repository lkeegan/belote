import type { Suit } from "../../shared/game";
import { recognizeFrench, localFrenchAvailability, installLocalFrench, supportsBrowserSpeech } from "./voice/browser";
import { parseVoiceCommand, resolveVoiceBid } from "./voice/commands";
import { BrowserVosk } from "./voice/vosk";

const select = <T extends HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;
const engine = select<HTMLSelectElement>("engine");
const listen = select<HTMLButtonElement>("listen");
const stop = select<HTMLButtonElement>("stop");
const install = select<HTMLButtonElement>("install");
const loadModel = select<HTMLButtonElement>("load-model");
const status = select<HTMLElement>("status");
const privacy = select<HTMLElement>("privacy");
const text = select<HTMLInputElement>("text");
const timing = select<HTMLElement>("timing");
const file = select<HTMLInputElement>("audio-file");
let abortSpeech: (() => void) | undefined;
let recorder: MediaRecorder | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let busy = false;
let generation = 0;
const vosk = new BrowserVosk();

function result(transcript: string): void {
  text.value = transcript;
  select<HTMLElement>("transcript").textContent = transcript || "(aucune transcription)";
  const command = parseVoiceCommand(transcript);
  const bid = command ? resolveVoiceBid(command, {
    round: Number(select<HTMLSelectElement>("round").value) as 1 | 2,
    turnedSuit: select<HTMLSelectElement>("turned").value as Suit,
  }) : null;
  select<HTMLElement>("command").textContent = JSON.stringify({ command, bid }, null, 2);
}

function idle(): void {
  busy = false;
  listen.disabled = false;
  engine.disabled = false;
  stop.disabled = true;
  file.disabled = engine.value.startsWith("browser");
  loadModel.disabled = false;
}

async function transcribe(audio: Blob, chosen: string): Promise<void> {
  status.textContent = "Vosk : chargement du modèle puis transcription sur cet appareil…";
  const started = performance.now();
  const data = await vosk.transcribe(audio, chosen === "vosk-grammar");
  result(data.text);
  timing.textContent = `${Math.round(performance.now() - started)} ms au total, dont ${data.inference_ms} ms d’inférence WASM (chargement et décodage exclus). Aucun envoi audio.`;
  status.textContent = "Terminé.";
}

listen.addEventListener("click", async () => {
  const token = ++generation;
  const chosen = engine.value;
  let stream: MediaStream | undefined;
  recorder = undefined;
  abortSpeech = undefined;
  busy = true;
  listen.disabled = engine.disabled = file.disabled = loadModel.disabled = true;
  stop.disabled = false;
  timing.textContent = "";
  status.textContent = "Écoute…";
  const started = performance.now();
  try {
    if (chosen.startsWith("browser")) {
      abortSpeech = recognizeFrench({
        result(transcript, confidence) {
          result(transcript);
          timing.textContent = `${Math.round(performance.now() - started)} ms depuis le début de l’écoute ; confiance indicative : ${confidence}.`;
          status.textContent = "Terminé.";
        },
        error(error) { status.textContent = `Reconnaissance : ${error}`; },
        end: idle,
      }, chosen === "browser-local");
    } else {
      stream = await navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: true, noiseSuppression: true, channelCount: 1,
      } });
      if (!busy || token !== generation) { stream.getTracks().forEach((track) => track.stop()); return; }
      const chunks: Blob[] = [];
      const recording = new MediaRecorder(stream);
      recorder = recording;
      recording.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recording.onstop = async () => {
        clearTimeout(timer);
        stream?.getTracks().forEach((track) => track.stop());
        stop.disabled = true;
        try { await transcribe(new Blob(chunks, { type: recording.mimeType }), chosen); }
        catch (error) { status.textContent = String(error); }
        finally { idle(); }
      };
      recording.start();
      timer = setTimeout(() => recording.state === "recording" && recording.stop(), 4000);
    }
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    if (token !== generation) return;
    status.textContent = String(error);
    idle();
  }
});

stop.addEventListener("click", () => {
  if (recorder?.state === "recording") recorder.stop();
  else { generation++; abortSpeech?.(); status.textContent = "Écoute arrêtée."; idle(); }
});

file.addEventListener("change", async () => {
  if (!file.files?.[0]) return;
  busy = true;
  listen.disabled = engine.disabled = file.disabled = loadModel.disabled = true;
  try { await transcribe(file.files[0], engine.value); }
  catch (error) { status.textContent = String(error); }
  finally { idle(); }
});

async function updateEngine(): Promise<void> {
  install.hidden = engine.value !== "browser-local";
  loadModel.hidden = !engine.value.startsWith("vosk-");
  file.disabled = engine.value.startsWith("browser");
  privacy.textContent = engine.value === "browser"
    ? "Le navigateur peut envoyer l’audio à son service distant. Safari : activez Siri et autorisez le microphone."
    : engine.value === "browser-local"
      ? `Traitement local obligatoire, expérimental. Français : ${await localFrenchAvailability()}. Aucun repli distant.`
      : "Vosk WASM traite l’audio uniquement sur cet appareil, dans un Web Worker. JavaScript et modèle français sont des fichiers statiques ; aucun serveur de reconnaissance.";
  listen.disabled = engine.value.startsWith("browser") && !supportsBrowserSpeech();
}

engine.addEventListener("change", () => { void updateEngine().catch((error) => { status.textContent = String(error); }); });
loadModel.addEventListener("click", async () => {
  busy = true;
  listen.disabled = engine.disabled = file.disabled = loadModel.disabled = true;
  status.textContent = "Chargement de Vosk français (~40 Mo au premier téléchargement)…";
  try { await vosk.load(); status.textContent = "Modèle Vosk prêt sur cet appareil."; }
  catch (error) { status.textContent = String(error); }
  finally { idle(); }
});
window.addEventListener("pagehide", () => {
  generation++;
  abortSpeech?.();
  if (recorder?.state === "recording") {
    recorder.onstop = null;
    recorder.stop();
    recorder.stream.getTracks().forEach((track) => track.stop());
  }
  clearTimeout(timer);
  vosk.dispose();
});
install.addEventListener("click", async () => {
  try {
    status.textContent = await installLocalFrench() ? "Français installé." : "Installation indisponible ou refusée.";
    await updateEngine();
  }
  catch (error) { status.textContent = String(error); }
});
select<HTMLButtonElement>("parse").addEventListener("click", () => result(text.value));
for (const id of ["round", "turned"]) select(id).addEventListener("change", () => result(text.value));
result(text.value);
void updateEngine();
