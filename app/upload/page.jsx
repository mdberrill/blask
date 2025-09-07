'use client';

import { useRef, useState, useEffect } from 'react';
import * as bodyPix from '@tensorflow-models/body-pix';
import '@tensorflow/tfjs';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { XR, createXRStore } from '@react-three/xr';
import * as THREE from 'three';

const store = createXRStore();

function ARVideoPlane({ canvas, video, width, height, onTogglePlay }) {
    const meshRef = useRef();
    const textureRef = useRef();
    const videoTextureRef = useRef();
    const { gl } = useThree();

    // create or re-create textures bound to the current GL context.
    // Use canvas mask texture when available, otherwise fall back to a VideoTexture.
    useEffect(() => {
        if (!gl) return;

        // dispose previous canvas texture if it exists and will be replaced
        if (textureRef.current && textureRef.current.image !== canvas) {
            try {
                textureRef.current.dispose();
            } catch (e) {}
            textureRef.current = null;
        }

        // if canvas provided, prefer CanvasTexture
        if (canvas) {
            if (!textureRef.current) {
                textureRef.current = new THREE.CanvasTexture(canvas);
                textureRef.current.encoding = THREE.sRGBEncoding;
                textureRef.current.flipY = false;
                textureRef.current.minFilter = THREE.LinearFilter;
                textureRef.current.magFilter = THREE.LinearFilter;
            }
            // dispose any existing video texture
            if (videoTextureRef.current) {
                try {
                    videoTextureRef.current.dispose();
                } catch (e) {}
                videoTextureRef.current = null;
            }
        } else if (video) {
            // create a VideoTexture fallback so the plane is visible immediately in AR
            if (!videoTextureRef.current) {
                videoTextureRef.current = new THREE.VideoTexture(video);
                videoTextureRef.current.encoding = THREE.sRGBEncoding;
                videoTextureRef.current.flipY = true;
                videoTextureRef.current.minFilter = THREE.LinearFilter;
                videoTextureRef.current.magFilter = THREE.LinearFilter;
            }
        }

        if (meshRef.current) {
            meshRef.current.frustumCulled = false;
            meshRef.current.renderOrder = 999;
            if (meshRef.current.material) meshRef.current.material.needsUpdate = true;
        }

        return () => {
            // do not aggressively dispose videoTexture here (will be recreated if needed)
        };
    }, [canvas, video, gl]);

    // ensure textures update each frame
    useFrame(() => {
        if (textureRef.current) textureRef.current.needsUpdate = true;
        if (videoTextureRef.current) videoTextureRef.current.needsUpdate = true;
    });

    const aspect = width && height ? width / height : 1;
    const planeHeight = 2;
    const planeWidth = planeHeight * aspect;

    const activeMap = textureRef.current || videoTextureRef.current || null;

    return (
        <>
            <mesh
                ref={meshRef}
                position={[0, planeHeight / 2, -4]}
                onClick={onTogglePlay}
                castShadow
                receiveShadow
                renderOrder={999}
            >
                <planeGeometry args={[planeWidth, planeHeight]} />
                <meshBasicMaterial
                    transparent={true}
                    toneMapped={false}
                    map={activeMap}
                    side={THREE.DoubleSide}
                    depthTest={false}
                    depthWrite={false}
                    alphaTest={0.01}
                />
            </mesh>

            {/* debug marker: small red box to verify visibility inside AR sessions */}
            <mesh position={[0, planeHeight + 0.2, -4]}>
                <boxGeometry args={[0.15, 0.15, 0.15]} />
                <meshBasicMaterial color={'red'} />
            </mesh>
        </>
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
                <button
                    className="ml-2 px-3 py-1 border"
                    onClick={() => {
                        // ensure the video is playing (user gesture) before entering AR so segmentation has frames
                        if (videoRef.current) {
                            videoRef.current.play().catch(() => {});
                        }
                        store.enterAR();
                    }}
                    disabled={!videoURL}
                >
                    Enter AR
                </button>
            </div>

            {/* keep the video and mask canvas rendered but visually hidden; avoid display:none so the canvas can be used as a texture */}
            <div
                style={{
                    position: 'fixed',
                    left: 0,
                    top: 0,
                    width: 1,
                    height: 1,
                    opacity: 0,
                    pointerEvents: 'none',
                    zIndex: -9999
                }}
            >
                <video ref={videoRef} src={videoURL || null} crossOrigin="anonymous" playsInline muted loop />
                <canvas ref={maskCanvasRef} />
            </div>

            <div style={{ width: '100%', height: '100vh', background: '#111', touchAction: 'none' }}>
                <Canvas gl={{ preserveDrawingBuffer: true }}>
                    <XR store={store}>
                        {maskCanvasRef.current && videoURL && videoSize.width > 0 && model && (
                            <ARVideoPlane
                                canvas={maskCanvasRef.current}
                                video={videoRef.current}
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
