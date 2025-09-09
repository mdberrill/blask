// Client-side utility to remove video background using TensorFlow BodyPix
// Exports a single async function that accepts a video URL and options.
// Returns a Promise that resolves with a Blob (the converted video) and
// also supports an optional onProgress callback in options.

export default async function convertVideoBackground(videoUrl, options = {}) {
    const { backgroundColor = '#00FF00', mimeType = 'video/webm', fps = 25, onProgress = null } = options;

    return new Promise(async (resolve, reject) => {
        try {
            // Load TF and BodyPix dynamically (client-only)
            await import('@tensorflow/tfjs');
            const bodyPix = await import('@tensorflow-models/body-pix');

            const net = await bodyPix.load({ architecture: 'MobileNetV1' });

            const video = document.createElement('video');
            video.crossOrigin = 'anonymous';
            // don't mute - we will capture audio via WebAudio so keep source available
            video.playsInline = true;
            video.src = videoUrl;

            // Wait for metadata so we know dimensions
            await new Promise((res, rej) => {
                const onLoaded = () => res();
                const onErr = (e) => rej(e);
                video.addEventListener('loadedmetadata', onLoaded, { once: true });
                video.addEventListener('error', onErr, { once: true });
            });

            const width = video.videoWidth || 640;
            const height = video.videoHeight || 360;

            // Prepare canvases
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = width;
            tempCanvas.height = height;
            const tempCtx = tempCanvas.getContext('2d');

            const outCanvas = document.createElement('canvas');
            outCanvas.width = width;
            outCanvas.height = height;
            const outCtx = outCanvas.getContext('2d');

            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = width;
            maskCanvas.height = height;
            const maskCtx = maskCanvas.getContext('2d');

            // MediaRecorder to capture the processed canvas and audio. We use WebAudio
            // to capture the video's audio track and combine it with the canvas stream.
            const supportedMime =
                (typeof MediaRecorder !== 'undefined' &&
                    MediaRecorder.isTypeSupported &&
                    MediaRecorder.isTypeSupported(mimeType)) ||
                false;
            const recorderMime = supportedMime ? mimeType : 'video/webm';

            const canvasStream = outCanvas.captureStream(fps);

            // Setup WebAudio to capture audio from the video element into a MediaStream
            let audioCtx = null;
            let audioDest = null;
            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                audioCtx = new AudioCtx();
                const src = audioCtx.createMediaElementSource(video);
                audioDest = audioCtx.createMediaStreamDestination();
                src.connect(audioDest);
                // don't connect to speakers (audioCtx.destination) to avoid audible playback
            } catch (e) {
                // WebAudio may not be available or allowed; fall back to relying on
                // the video element's captureStream audio if possible.
                audioCtx = null;
                audioDest = null;
            }

            // combine video (canvas) tracks and audio tracks
            const combinedStream = new MediaStream();
            // add canvas video tracks
            canvasStream.getVideoTracks().forEach((t) => combinedStream.addTrack(t));
            // prefer WebAudio destination stream if available
            if (audioDest && audioDest.stream && audioDest.stream.getAudioTracks().length) {
                audioDest.stream.getAudioTracks().forEach((t) => combinedStream.addTrack(t));
            } else if (typeof video.captureStream === 'function') {
                // fallback: try to get audio from the original video element's stream
                try {
                    const srcStream = video.captureStream ? video.captureStream() : null;
                    if (srcStream) {
                        srcStream.getAudioTracks().forEach((t) => combinedStream.addTrack(t));
                    }
                } catch (e) {
                    // ignore
                }
            }

            const recordedChunks = [];
            const recorder = new MediaRecorder(combinedStream, { mimeType: recorderMime });
            recorder.ondataavailable = (e) => {
                if (e.data && e.data.size) recordedChunks.push(e.data);
            };
            recorder.onerror = (ev) => {
                console.error('MediaRecorder error', ev);
            };
            recorder.onstop = () => {
                const blob = new Blob(recordedChunks, { type: recorderMime });
                // cleanup audio context
                try {
                    if (audioCtx && typeof audioCtx.close === 'function') audioCtx.close();
                } catch (e) {
                    // ignore
                }
                resolve(blob);
            };

            // Start processing
            // Play video (user gesture required for audio in some browsers).
            await video.play().catch(() => {
                // If play() is blocked, recording will still attempt to proceed but audio
                // capture may be blocked by browser autoplay policies.
            });

            // resume audio context if created (may require user gesture)
            if (audioCtx && typeof audioCtx.resume === 'function') {
                try {
                    await audioCtx.resume();
                } catch (e) {
                    // ignore
                }
            }

            recorder.start();

            let stopped = false;

            const processFrame = async () => {
                if (video.paused || video.ended || stopped) {
                    // ensure recording finalised
                    try {
                        if (recorder.state !== 'inactive') recorder.stop();
                    } catch (err) {
                        // ignore
                    }
                    // stop audio tracks on combined stream
                    try {
                        combinedStream.getTracks().forEach((t) => {
                            try {
                                t.stop();
                            } catch (e) {}
                        });
                    } catch (e) {}
                    return;
                }

                // draw current video frame to temp canvas
                tempCtx.drawImage(video, 0, 0, width, height);

                // run person segmentation on the video element (fast path)
                const segmentation = await net.segmentPerson(video, {
                    flipHorizontal: false,
                    internalResolution: 'medium',
                    segmentationThreshold: 0.7
                });

                // build mask image data
                const maskImage = maskCtx.createImageData(width, height);
                const d = maskImage.data;
                const seg = segmentation.data;
                for (let i = 0; i < seg.length; i++) {
                    const alpha = seg[i] ? 255 : 0;
                    d[i * 4 + 0] = 255;
                    d[i * 4 + 1] = 255;
                    d[i * 4 + 2] = 255;
                    d[i * 4 + 3] = alpha;
                }
                maskCtx.putImageData(maskImage, 0, 0);

                // composite: green background, then person from tempCanvas masked
                outCtx.clearRect(0, 0, width, height);
                outCtx.fillStyle = backgroundColor;
                outCtx.fillRect(0, 0, width, height);

                // draw the source video frame
                outCtx.drawImage(tempCanvas, 0, 0, width, height);

                // apply mask so only person remains (destination-in keeps intersection)
                outCtx.globalCompositeOperation = 'destination-in';
                outCtx.drawImage(maskCanvas, 0, 0, width, height);
                outCtx.globalCompositeOperation = 'source-over';

                if (typeof onProgress === 'function' && video.duration) {
                    try {
                        onProgress(Math.min(1, video.currentTime / video.duration));
                    } catch (e) {
                        // ignore progress handler errors
                    }
                }

                // next frame
                requestAnimationFrame(processFrame);
            };

            requestAnimationFrame(processFrame);
        } catch (err) {
            reject(err);
        }
    });
}
