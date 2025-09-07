'use client';

import { useRef, useState, useEffect } from 'react';
import * as bodyPix from '@tensorflow-models/body-pix';
import '@tensorflow/tfjs';
import { Canvas } from '@react-three/fiber';
import { XR, createXRStore } from '@react-three/xr';
import * as THREE from 'three';

const store = createXRStore();

function ARVideoPlane({ canvas, width, height, onTogglePlay }) {
    const meshRef = useRef();
    const textureRef = useRef();

    useEffect(() => {
        if (!canvas) return;
        textureRef.current = new THREE.CanvasTexture(canvas);
        textureRef.current.encoding = THREE.sRGBEncoding;
        textureRef.current.flipY = false;
        textureRef.current.needsUpdate = true;
    }, [canvas]);

    // keep texture updated each frame
    useEffect(() => {
        let mounted = true;
        const id = () => {
            if (!mounted) return;
            if (textureRef.current) textureRef.current.needsUpdate = true;
            requestAnimationFrame(id);
        };
        requestAnimationFrame(id);
        return () => {
            mounted = false;
        };
    }, []);

    const aspect = width && height ? width / height : 1;
    const planeHeight = 2; // meters tall (approx person height)
    const planeWidth = planeHeight * aspect;

    return (
        <mesh ref={meshRef} position={[0, planeHeight / 2, -4]} onClick={onTogglePlay} castShadow receiveShadow>
            <planeGeometry args={[planeWidth, planeHeight]} />
            <meshBasicMaterial transparent={true} toneMapped={false} map={textureRef.current} side={THREE.DoubleSide} />
        </mesh>
    );
}

export default function Page() {
    const videoRef = useRef(null);
    const maskCanvasRef = useRef(null);
    const [model, setModel] = useState(null);
    const [videoURL, setVideoURL] = useState(null);
    const [playing, setPlaying] = useState(false);
    const [videoSize, setVideoSize] = useState({ width: 640, height: 480 });
    const [loadingModel, setLoadingModel] = useState(true);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const m = await bodyPix.load();
                if (!cancelled) {
                    setModel(m);
                }
            } catch (e) {
                console.error('Failed to load BodyPix model', e);
            } finally {
                if (!cancelled) setLoadingModel(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!videoRef.current || !maskCanvasRef.current) return;
        const video = videoRef.current;
        const canvas = maskCanvasRef.current;
        const ctx = canvas.getContext('2d');
        let rafId = null;
        let running = true;

        async function frameLoop() {
            if (!running) return;
            if (!model || video.ended) {
                rafId = requestAnimationFrame(frameLoop);
                return;
            }
            if (!video.videoWidth || !video.videoHeight) {
                rafId = requestAnimationFrame(frameLoop);
                return;
            }

            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            setVideoSize({ width: video.videoWidth, height: video.videoHeight });

            // Draw the current video frame to the canvas (skipped here; we'll compose flipped below)

            try {
                const segmentation = await model.segmentPerson(video, {
                    internalResolution: 'medium',
                    segmentationThreshold: 0.7,
                    maxDetections: 1
                });

                // Count positive person pixels; if too few, fall back to drawing the video unmasked
                const segData = segmentation.data;
                let count = 0;
                for (let i = 0; i < segData.length; i++) {
                    if (segData[i]) count++;
                }

                if (count < 100) {
                    // fallback: draw video (flipped) without mask to avoid full transparency when segmentation fails
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.save();
                    ctx.translate(0, canvas.height);
                    ctx.scale(1, -1);
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    ctx.restore();
                } else {
                    const mask = bodyPix.toMask(segmentation, { r: 0, g: 0, b: 0, a: 255 }, { r: 0, g: 0, b: 0, a: 0 });

                    // create temporary canvas for mask
                    const maskCanvas = document.createElement('canvas');
                    maskCanvas.width = canvas.width;
                    maskCanvas.height = canvas.height;
                    const mctx = maskCanvas.getContext('2d');
                    mctx.putImageData(mask, 0, 0);

                    // Apply mask as alpha: draw video with a vertical flip (fixes upside-down mobiles),
                    // then keep only the masked (person) area so the background is transparent.
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.save();
                    ctx.translate(0, canvas.height);
                    ctx.scale(1, -1);
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    ctx.globalCompositeOperation = 'destination-in';
                    ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);
                    ctx.restore();
                }
            } catch (err) {
                console.error('segmentation error', err);
            }

            rafId = requestAnimationFrame(frameLoop);
        }

        rafId = requestAnimationFrame(frameLoop);

        return () => {
            running = false;
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, [model, videoURL]);

    function handleFile(e) {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        const url = URL.createObjectURL(f);
        setVideoURL(url);
        setPlaying(false);
        if (videoRef.current) {
            videoRef.current.src = url;
            videoRef.current.load();
        }
    }

    function togglePlay() {
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) {
            v.play();
            setPlaying(true);
        } else {
            v.pause();
            setPlaying(false);
        }
    }

    return (
        <div>
            <h1 className="mb-4 text-xl font-medium">Upload video to project them in AR.</h1>

            <div className="mb-4">
                <input type="file" accept="video/*" onChange={handleFile} />
                <button className="ml-2 px-3 py-1 border" onClick={() => store.enterAR()} disabled={!videoURL}>
                    Enter AR
                </button>
            </div>

            <div style={{ display: 'none' }}>
                <video ref={videoRef} src={videoURL || null} crossOrigin="anonymous" playsInline muted loop />
                <canvas ref={maskCanvasRef} />
            </div>

            <div style={{ width: '100%', height: 500, background: '#111' }}>
                <Canvas>
                    <XR store={store}>
                        {maskCanvasRef.current && videoURL && videoSize.width > 0 && model && (
                            <ARVideoPlane
                                canvas={maskCanvasRef.current}
                                width={videoSize.width}
                                height={videoSize.height}
                                onTogglePlay={togglePlay}
                            />
                        )}
                    </XR>
                </Canvas>
            </div>

            <div className="mt-4">
                {loadingModel ? <p>Loading segmentation model...</p> : <p>Model ready.</p>}
                <p>{playing ? 'Playing' : 'Paused'}</p>
            </div>
        </div>
    );
}
