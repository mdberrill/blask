'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { XR, createXRStore } from '@react-three/xr';
import * as THREE from 'three';

const store = createXRStore();

export default function UploadAR({ videoSrc }) {
    const videoRef = useRef(null);
    const [texture, setTexture] = useState(null);
    const [playing, setPlaying] = useState(false);
    const [placed, setPlaced] = useState(false);
    const [transform, setTransform] = useState({ position: [0, 1.2, -1.5], rotation: [0, 0, 0] });
    const [showVideo, setShowVideo] = useState(false);
    const [xrSupported, setXrSupported] = useState(null);
    const [preview3D, setPreview3D] = useState(false);

    useEffect(() => {
        if (!videoSrc) return;

        const vid = document.createElement('video');
        vid.src = videoSrc;
        vid.crossOrigin = 'anonymous';
        vid.loop = true;
        vid.muted = true; // autoplay policies
        vid.playsInline = true;
        // make the element part of the DOM but hidden; this can help on some mobile browsers
        vid.style.position = 'absolute';
        vid.style.left = '-9999px';
        vid.style.width = '1px';
        vid.style.height = '1px';
        document.body.appendChild(vid);

        let createdTex = null;
        let segmentationLoop = { running: false, cancel: false };
        let model = null;
        let sourceCanvas = null;
        let outputCanvas = null;
        let canvasTex = null;

        const initBodyPix = async (videoEl) => {
            try {
                // Load TF backend and BodyPix dynamically to avoid SSR and extra bundle cost
                const tf = await import('@tensorflow/tfjs');
                // prefer webgl if available
                try {
                    await tf.setBackend('webgl');
                } catch (e) {}
                await tf.ready();
                const bodyPix = await import('@tensorflow-models/body-pix');

                // lightweight model config for real-time on mobile
                model = await bodyPix.load({
                    architecture: 'MobileNetV1',
                    outputStride: 16,
                    multiplier: 0.75,
                    quantBytes: 2
                });

                // create canvases sized to video
                const w = videoEl.videoWidth || 640;
                const h = videoEl.videoHeight || 360;
                sourceCanvas = document.createElement('canvas');
                sourceCanvas.width = w;
                sourceCanvas.height = h;
                outputCanvas = document.createElement('canvas');
                outputCanvas.width = w;
                outputCanvas.height = h;

                // create a THREE texture from the output canvas
                canvasTex = new THREE.CanvasTexture(outputCanvas);
                canvasTex.minFilter = THREE.LinearFilter;
                canvasTex.magFilter = THREE.LinearFilter;
                canvasTex.format = THREE.RGBAFormat;
                // ensure alpha is preserved and not premultiplied incorrectly
                canvasTex.premultiplyAlpha = false;

                // swap texture into state so the AR material uses it
                setTexture(canvasTex);

                // segmentation loop
                segmentationLoop.running = true;

                const sourceCtx = sourceCanvas.getContext('2d', { alpha: true });
                const outCtx = outputCanvas.getContext('2d', { alpha: true });

                // target FPS for segmentation (tune for performance)
                const targetFps = 12;
                const frameDelay = 1000 / targetFps;

                async function runLoop() {
                    let last = performance.now();
                    while (segmentationLoop.running && !segmentationLoop.cancel) {
                        const now = performance.now();
                        if (now - last < frameDelay) {
                            // small sleep between frames to cap CPU
                            await new Promise((r) => setTimeout(r, 5));
                            continue;
                        }
                        last = now;

                        try {
                            // draw current video frame to source
                            sourceCtx.drawImage(videoEl, 0, 0, sourceCanvas.width, sourceCanvas.height);

                            // ask BodyPix for a person mask
                            const segmentation = await model.segmentPerson(sourceCanvas, {
                                internalResolution: 'medium',
                                segmentationThreshold: 0.7
                            });

                            // pull pixel data and apply alpha from mask
                            const src = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
                            const out = outCtx.createImageData(sourceCanvas.width, sourceCanvas.height);
                            const mask = segmentation.data;
                            // mask length == width*height; src.data length == width*height*4
                            for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
                                const alpha = mask[i] ? 255 : 0;
                                out.data[p] = src.data[p];
                                out.data[p + 1] = src.data[p + 1];
                                out.data[p + 2] = src.data[p + 2];
                                out.data[p + 3] = alpha;
                            }

                            outCtx.putImageData(out, 0, 0);

                            // update three texture
                            if (canvasTex) canvasTex.needsUpdate = true;
                        } catch (e) {
                            // segmentation can fail if video not ready; ignore and continue
                        }
                    }
                }

                runLoop().catch(() => {});
            } catch (e) {
                // bodypix not available or failed; fall back to video texture
                console.warn('BodyPix init failed:', e);
            }
        };

        const handleCanPlay = () => {
            // create a temporary video texture immediately so preview can show
            const tex = new THREE.VideoTexture(vid);
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.format = THREE.RGBAFormat;
            createdTex = tex;
            setTexture(tex);
            // attempt to play; user may need to tap to start in some browsers
            vid.play()
                .then(() => setPlaying(true))
                .catch(() => setPlaying(false));

            // kick off BodyPix initialization; if it succeeds it will replace the texture
            initBodyPix(vid);
        };

        vid.addEventListener('canplay', handleCanPlay);

        videoRef.current = vid;

        return () => {
            // stop segmentation loop
            segmentationLoop.cancel = true;
            segmentationLoop.running = false;

            vid.pause();
            vid.removeEventListener('canplay', handleCanPlay);
            if (createdTex) {
                try {
                    createdTex.dispose();
                } catch (e) {}
            }
            if (canvasTex) {
                try {
                    canvasTex.dispose();
                } catch (e) {}
            }
            // remove the hidden video element from DOM
            try {
                if (vid.parentNode) vid.parentNode.removeChild(vid);
            } catch (e) {}
        };
    }, [videoSrc]);

    useEffect(() => {
        // Sync play state to the video element when user toggles AR entry
        const vid = videoRef.current;
        if (!vid) return;
        if (playing) vid.play().catch(() => {});
        else vid.pause();
    }, [playing]);

    function enterAR() {
        // Ensure video plays before entering AR where possible
        const vid = videoRef.current;
        const tryPlay = vid ? vid.play().catch(() => {}) : Promise.resolve();
        tryPlay.finally(() => {
            // small delay can help ensure the first frame is ready
            setTimeout(() => {
                if (xrSupported) {
                    store.enterAR();
                } else {
                    // fallback to inline 3D preview when WebXR not available
                    setPreview3D(true);
                }
            }, 150);
        });
    }

    useEffect(() => {
        // feature detect WebXR 'immersive-ar' support
        async function check() {
            try {
                // If navigator.xr isn't present, try to dynamically load a polyfill if installed
                if (!navigator.xr) {
                    // dynamic import may fail if the package isn't installed; catch and continue
                    try {
                        const mod = await import('webxr-polyfill');
                        const WebXRPolyfill = mod && (mod.default || mod.WebXRPolyfill || mod.WebXRPolyfill_default);
                        if (WebXRPolyfill) {
                            // instantiate polyfill
                            try {
                                new WebXRPolyfill();
                            } catch (e) {}
                        }
                    } catch (e) {
                        // swallow: polyfill not installed
                    }
                }

                if (navigator.xr && navigator.xr.isSessionSupported) {
                    const supported = await navigator.xr.isSessionSupported('immersive-ar');
                    setXrSupported(!!supported);
                    return;
                }
            } catch (e) {}
            // some browsers (or iOS Safari) don't implement WebXR
            setXrSupported(false);
        }
        check();
    }, []);

    async function tryPolyfill() {
        try {
            const mod = await import('webxr-polyfill');
            const WebXRPolyfill = mod && (mod.default || mod.WebXRPolyfill || mod.WebXRPolyfill_default);
            if (WebXRPolyfill) {
                try {
                    new WebXRPolyfill();
                } catch (e) {}
                // re-check support
                if (navigator.xr && navigator.xr.isSessionSupported) {
                    const supported = await navigator.xr.isSessionSupported('immersive-ar');
                    setXrSupported(!!supported);
                    return;
                }
            }
        } catch (e) {
            // dynamic import failed - likely not installed
        }
        setXrSupported(false);
    }

    return (
        <div>
            <div className="mb-2">
                <button className="px-3 py-2 bg-sky-600 text-white rounded" onClick={enterAR}>
                    Enter AR with video overlay
                </button>
            </div>

            <div style={{ width: '100%', height: '60vh', maxWidth: 640 }}>
                {xrSupported === false && !preview3D && (
                    <div className="p-4 border rounded bg-yellow-50">
                        <div className="mb-2 font-medium">WebXR not supported on this device/browser</div>
                        <div className="text-sm mb-3">
                            You can still preview the scene inline. For full AR you need a compatible browser/device
                            (Chrome on Android or supported WebXR browsers).
                        </div>
                        <div className="flex gap-2">
                            <button
                                className="px-3 py-2 bg-sky-600 text-white rounded"
                                onClick={() => setPreview3D(true)}
                            >
                                Open 3D preview
                            </button>
                            <button className="px-3 py-2 bg-white border rounded" onClick={() => tryPolyfill()}>
                                Try polyfill
                            </button>
                        </div>
                    </div>
                )}

                {(xrSupported === true || preview3D) && (
                    <Canvas gl={{ alpha: true, preserveDrawingBuffer: false }}>
                        <XR store={store} inline={!xrSupported || preview3D}>
                            {texture ? (
                                <>
                                    <PlacementHandler
                                        onPlace={(pos, rot) => {
                                            setTransform({ position: pos, rotation: rot });
                                            setPlaced(true);
                                        }}
                                    />

                                    {showVideo ? (
                                        // show the video plane when toggled
                                        texture ? (
                                            <VideoMesh
                                                texture={texture}
                                                videoRef={videoRef}
                                                position={placed ? transform.position : transform.position}
                                                rotation={placed ? transform.rotation : transform.rotation}
                                            />
                                        ) : (
                                            // fallback while texture prepares
                                            <mesh position={placed ? transform.position : transform.position}>
                                                <boxGeometry args={[0.2, 0.2, 0.2]} />
                                                <meshBasicMaterial color={'#222'} />
                                            </mesh>
                                        )
                                    ) : (
                                        // show clickable cube that swaps to the video on click
                                        <mesh
                                            position={placed ? transform.position : transform.position}
                                            onClick={async (e) => {
                                                // play video if available and then show
                                                const vid = videoRef.current;
                                                if (vid) {
                                                    try {
                                                        await vid.play();
                                                    } catch (e) {}
                                                }
                                                setShowVideo(true);
                                            }}
                                            pointerEventsType={{ deny: 'grab' }}
                                        >
                                            <boxGeometry args={[0.4, 0.8, 0.15]} />
                                            <meshStandardMaterial color={'#0366d6'} metalness={0.3} roughness={0.6} />
                                        </mesh>
                                    )}
                                </>
                            ) : (
                                <mesh>
                                    <boxGeometry args={[0.2, 0.2, 0.2]} />
                                    <meshNormalMaterial />
                                </mesh>
                            )}
                        </XR>
                    </Canvas>
                )}
            </div>

            <div className="mt-2 space-x-2">
                <button
                    className="px-3 py-1 bg-gray-200"
                    onClick={() => {
                        setPlaced(false);
                        setTransform({ position: [0, 1.2, -1.5], rotation: [0, 0, 0] });
                    }}
                >
                    Reset placement
                </button>
            </div>

            <div className="mt-2 text-sm text-slate-500">
                The AR view will overlay the video onto a plane. Move your phone around to place it so the speaker
                appears in the room.
            </div>
        </div>
    );
}

function VideoMesh({ texture, videoRef }) {
    const meshRef = useRef();

    // update the video texture each frame so it shows animation in AR
    useFrame(() => {
        if (texture) {
            // If it's a VideoTexture it will animate; if it's a CanvasTexture from BodyPix we still need to mark it
            texture.needsUpdate = true;
        }
    });

    // attempt to size plane based on video dimensions if available
    const [size, setSize] = useState([1.6, 0.9]);

    useEffect(() => {
        const v = videoRef.current;
        if (v && v.videoWidth && v.videoHeight) {
            const aspect = v.videoWidth / v.videoHeight;
            const height = 1.0;
            const width = height * aspect;
            setSize([width, height]);
        }
    }, [videoRef]);

    return (
        <mesh ref={meshRef} position={[0, 1.2, -1.5]} rotation={[0, 0, 0]}>
            <planeGeometry args={size} />
            <meshBasicMaterial
                toneMapped={false}
                map={texture}
                side={THREE.DoubleSide}
                transparent={true}
                alphaTest={0.01}
                depthWrite={false}
            />
        </mesh>
    );
}

function PlacementHandler({ onPlace }) {
    const { camera, gl } = useThree();
    const raycaster = useRef(new THREE.Raycaster());

    useEffect(() => {
        function handleClick(ev) {
            // compute a point 1.5 meters in front of the camera in world space
            const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
            const pos = new THREE.Vector3().copy(camera.position).add(dir.multiplyScalar(1.5));
            // rotation: face the camera
            const lookAt = new THREE.Vector3().copy(camera.position);
            const meshQuat = new THREE.Quaternion().setFromRotationMatrix(
                new THREE.Matrix4().lookAt(pos, lookAt, new THREE.Vector3(0, 1, 0))
            );
            const euler = new THREE.Euler().setFromQuaternion(meshQuat);
            onPlace([pos.x, pos.y, pos.z], [euler.x, euler.y, euler.z]);
        }

        // Try to listen for XR select on the WebXR session if available
        const canvas = gl.domElement;
        canvas.addEventListener('click', handleClick);

        return () => {
            canvas.removeEventListener('click', handleClick);
        };
    }, [camera, gl, onPlace]);

    return null;
}
