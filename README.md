# Odometer reader

A small TypeScript app that reads digital kilometer displays with OCR in the browser. Photos are processed locally and are not sent to a backend.

## Run on your development machine

Install dependencies and start the Vite development server:

```sh
npm install
npm run dev
```

Vite listens on all network interfaces over HTTPS. Open the `Network` URL printed by Vite on your phone while it is connected to the same network. The development certificate is self-signed, so the browser will show a certificate warning; accept it for your own development server. HTTPS is needed for phone browsers to grant live-camera access to a LAN-hosted app.

Tap **Open camera**, allow camera permission, and align the odometer digits inside the green guide. Tap the camera preview (or **Take photo**) to capture and read automatically. The app previews only the green-guide crop. The camera view requests the widest zoom available where supported. Alternatively, choose an already-cropped image of the display; image processing stays local in the browser.

Adjust the guide width and height with the sliders below the camera preview. The selected dimensions are saved in browser storage for the next use on that browser.

The first OCR run may download the OCR engine and English language data in the browser and can take a little longer. Reading is performed in the browser; the development server does not receive the image.

## Publish with GitHub Pages

The included GitHub Actions workflow builds and deploys the site whenever changes are pushed to `main`, or when run manually from the Actions tab.

1. Push this project to a GitHub repository.
2. In **Settings → Pages**, set **Build and deployment → Source** to **GitHub Actions**.
3. Push to `main` or run **Deploy to GitHub Pages** from the repository's **Actions** tab. The published URL appears in the workflow run.

The Vite build uses relative asset paths, so it works under a repository Pages URL without configuring the repository name. To deploy from a different branch, update the branch in `.github/workflows/deploy.yml`.
