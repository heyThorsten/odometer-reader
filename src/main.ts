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

let selectedFile: File | null = null;
let selectedImageSource: OdometerImageSource = "camera";
let previewUrl: string | null = null;
let selectionRevision = 0;
let cameraStream: MediaStream | null = null;

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
    const cropX = Math.round(canvas.width * 0.25);
    const cropY = Math.round(canvas.height * 0.37);
    const cropWidth = Math.round(canvas.width * 0.5);
    const cropHeight = Math.round(canvas.height * 0.13);
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
