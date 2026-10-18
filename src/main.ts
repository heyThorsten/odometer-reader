import "./style.css";
import { readOdometer, type OdometerImageSource } from "./odometer";

const openCameraButton = document.querySelector<HTMLButtonElement>("#open-camera")!;
const cameraPanel = document.querySelector<HTMLElement>("#camera-panel")!;
const cameraView = document.querySelector<HTMLButtonElement>("#camera-view")!;
const cameraVideo = document.querySelector<HTMLVideoElement>("#camera-video")!;
const captureButton = document.querySelector<HTMLButtonElement>("#capture-photo")!;
const cancelCameraButton = document.querySelector<HTMLButtonElement>("#cancel-camera")!;
const photoFileInput = document.querySelector<HTMLInputElement>("#photo-file")!;
const previewWrap = document.querySelector<HTMLDivElement>("#preview-wrap")!;
const photoPreview = document.querySelector<HTMLImageElement>("#photo-preview")!;
const readButton = document.querySelector<HTMLButtonElement>("#read-button")!;
const status = document.querySelector<HTMLDivElement>("#status")!;
const result = document.querySelector<HTMLDivElement>("#result")!;
const reading = document.querySelector<HTMLOutputElement>("#reading")!;
const recognitionMethod = document.querySelector<HTMLElement>("#recognition-method")!;
const guideWidthInput = document.querySelector<HTMLInputElement>("#guide-width")!;
const guideHeightInput = document.querySelector<HTMLInputElement>("#guide-height")!;
const guideWidthValue = document.querySelector<HTMLOutputElement>("#guide-width-value")!;
const guideHeightValue = document.querySelector<HTMLOutputElement>("#guide-height-value")!;
const guideMask = cameraView.querySelector<SVGPathElement>(".camera-mask path")!;

let selectedFile: File | null = null;
let selectedImageSource: OdometerImageSource = "camera";
let previewUrl: string | null = null;
let selectionRevision = 0;
let cameraStream: MediaStream | null = null;

const GUIDE_STORAGE_KEY = "odometer-reader-guide-dimensions";
const GUIDE_CENTER_Y = 43.5;
const DEFAULT_GUIDE_DIMENSIONS = { width: 50, height: 13 };
const GUIDE_WIDTH_RANGE = { min: 30, max: 80 };
const GUIDE_HEIGHT_RANGE = { min: 7, max: 30 };

type GuideDimensions = typeof DEFAULT_GUIDE_DIMENSIONS;

function isInRange(value: unknown, range: { min: number; max: number }): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= range.min
    && value <= range.max;
}

function loadGuideDimensions(): GuideDimensions {
  try {
    const saved = localStorage.getItem(GUIDE_STORAGE_KEY);
    if (!saved) return { ...DEFAULT_GUIDE_DIMENSIONS };

    const parsed: unknown = JSON.parse(saved);
    if (
      typeof parsed === "object"
      && parsed !== null
      && "width" in parsed
      && "height" in parsed
      && isInRange(parsed.width, GUIDE_WIDTH_RANGE)
      && isInRange(parsed.height, GUIDE_HEIGHT_RANGE)
    ) {
      return { width: parsed.width, height: parsed.height };
    }

    localStorage.removeItem(GUIDE_STORAGE_KEY);
    status.textContent = "Saved guide dimensions were invalid and have been reset.";
  } catch {
    status.textContent = "Could not access browser storage. Guide dimensions will not be saved.";
  }

  return { ...DEFAULT_GUIDE_DIMENSIONS };
}

let guideDimensions = loadGuideDimensions();

function applyGuideDimensions(): void {
  guideWidthInput.value = String(guideDimensions.width);
  guideHeightInput.value = String(guideDimensions.height);
  guideWidthValue.value = `${guideDimensions.width}%`;
  guideHeightValue.value = `${guideDimensions.height}%`;
  cameraView.style.setProperty("--guide-width", `${guideDimensions.width}%`);
  cameraView.style.setProperty("--guide-height", `${guideDimensions.height}%`);

  const left = (100 - guideDimensions.width) / 2;
  const top = GUIDE_CENTER_Y - guideDimensions.height / 2;
  guideMask.setAttribute(
    "d",
    `M0 0h100v100H0z M${left} ${top}h${guideDimensions.width}v${guideDimensions.height}H${left}z`,
  );
}

function saveGuideDimensions(): void {
  try {
    localStorage.setItem(GUIDE_STORAGE_KEY, JSON.stringify(guideDimensions));
    status.textContent = "Guide dimensions saved for next use.";
  } catch {
    status.textContent = "Could not save guide dimensions in browser storage. They will reset next time.";
  }
}

applyGuideDimensions();
guideWidthInput.addEventListener("input", () => {
  guideDimensions.width = Number(guideWidthInput.value);
  applyGuideDimensions();
});
guideHeightInput.addEventListener("input", () => {
  guideDimensions.height = Number(guideHeightInput.value);
  applyGuideDimensions();
});
guideWidthInput.addEventListener("change", saveGuideDimensions);
guideHeightInput.addEventListener("change", saveGuideDimensions);

function stopCamera(): void {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  cameraVideo.srcObject = null;
  captureButton.disabled = true;
  cameraView.disabled = true;
  cameraPanel.hidden = true;
  openCameraButton.disabled = false;
}

function clearReading(): void {
  result.hidden = true;
  reading.textContent = "";
  recognitionMethod.textContent = "";
}

function setSelectedPhoto(file: File, source: OdometerImageSource): void {
  selectionRevision += 1;
  selectedFile = file;
  selectedImageSource = source;
  clearReading();
  readButton.disabled = false;
  status.textContent = "Image ready. Tap “Read odometer” to scan it.";
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  photoPreview.src = previewUrl;
  previewWrap.hidden = false;
}

photoFileInput.addEventListener("change", () => {
  const file = photoFileInput.files?.[0];
  if (!file) return;

  photoFileInput.value = "";
  stopCamera();
  setSelectedPhoto(file, "display");
});

async function readSelectedPhoto(file: File, source: OdometerImageSource): Promise<void> {
  const revision = selectionRevision;
  readButton.disabled = true;
  result.hidden = true;
  status.textContent = "Reading photo in your browser…";
  try {
    const detected = await readOdometer(file, source);
    if (revision !== selectionRevision) return;
    if (!detected) {
      status.textContent = "No clear odometer reading found. Try a closer, well-lit photo of the display.";
      return;
    }

    reading.textContent = detected.value;
    recognitionMethod.textContent = detected.method === "custom"
      ? "Recognized by custom algorithm"
      : "Recognized by Tesseract.js";
    result.hidden = false;
    status.textContent = "Reading complete.";
  } catch (error) {
    if (revision !== selectionRevision) return;
    status.textContent = error instanceof Error
      ? `Could not read this photo: ${error.message}`
      : "Could not read this photo. Please try another image.";
  } finally {
    if (revision === selectionRevision) readButton.disabled = false;
  }
}

openCameraButton.addEventListener("click", async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    status.textContent = "Live camera is unavailable. Open this app over HTTPS to take a photo.";
    return;
  }

  openCameraButton.disabled = true;
  clearReading();
  status.textContent = "Waiting for camera permission…";
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" } },
    });
    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
    cameraView.style.aspectRatio = `${cameraVideo.videoWidth} / ${cameraVideo.videoHeight}`;
    cameraPanel.hidden = false;
    previewWrap.hidden = true;
    clearReading();
    captureButton.disabled = false;
    cameraView.disabled = false;
    status.textContent = "Camera ready. Align the odometer display in the guide.";
  } catch (error) {
    stopCamera();
    status.textContent = error instanceof Error
      ? `Could not open the camera: ${error.message}. Check camera permission and try again.`
      : "Could not open the camera. Check camera permission and try again.";
  }
});

async function capturePhoto(): Promise<void> {
  if (!cameraStream || !cameraVideo.videoWidth || !cameraVideo.videoHeight) return;

  captureButton.disabled = true;
  cameraView.disabled = true;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = cameraVideo.videoWidth;
    canvas.height = cameraVideo.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot capture camera images.");
    context.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
    const cropX = Math.round(canvas.width * (100 - guideDimensions.width) / 200);
    const cropY = Math.round(canvas.height * (GUIDE_CENTER_Y - guideDimensions.height / 2) / 100);
    const cropWidth = Math.round(canvas.width * guideDimensions.width / 100);
    const cropHeight = Math.round(canvas.height * guideDimensions.height / 100);
    const croppedCanvas = document.createElement("canvas");
    croppedCanvas.width = cropWidth;
    croppedCanvas.height = cropHeight;
    const croppedContext = croppedCanvas.getContext("2d");
    if (!croppedContext) throw new Error("This browser cannot crop the camera image.");
    croppedContext.drawImage(canvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    const photo = await new Promise<Blob>((resolve, reject) => {
      croppedCanvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The camera image could not be saved."));
      }, "image/jpeg", 0.95);
    });
    stopCamera();
    const croppedPhoto = new File([photo], `odometer-${Date.now()}.jpg`, { type: "image/jpeg" });
    setSelectedPhoto(croppedPhoto, "cropped");
    await readSelectedPhoto(croppedPhoto, "cropped");
  } catch (error) {
    captureButton.disabled = false;
    cameraView.disabled = false;
    status.textContent = error instanceof Error
      ? `Could not capture photo: ${error.message}`
      : "Could not capture photo. Please try again.";
  }
}

captureButton.addEventListener("click", () => void capturePhoto());
cameraView.addEventListener("click", () => void capturePhoto());

cancelCameraButton.addEventListener("click", stopCamera);
window.addEventListener("pagehide", stopCamera);

readButton.addEventListener("click", async () => {
  if (!selectedFile) return;

  await readSelectedPhoto(selectedFile, selectedImageSource);
});
