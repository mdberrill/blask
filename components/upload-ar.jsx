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

        const handleCanPlay = () => {
            const tex = new THREE.VideoTexture(vid);
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.format = THREE.RGBAFormat;
            createdTex = tex;
            setTexture(tex);
            // attempt to play; user may need to tap to start in some browsers
            vid.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        };

        vid.addEventListener('canplay', handleCanPlay);

        videoRef.current = vid;

        return () => {
            vid.pause();
            vid.removeEventListener('canplay', handleCanPlay);
            if (createdTex) {
                createdTex.dispose();
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
                            try { new WebXRPolyfill(); } catch (e) {}
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
                try { new WebXRPolyfill(); } catch (e) {}
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
                            <div className="text-sm mb-3">You can still preview the scene inline. For full AR you need a compatible browser/device (Chrome on Android or supported WebXR browsers).</div>
                            <div className="flex gap-2">
                                <button className="px-3 py-2 bg-sky-600 text-white rounded" onClick={() => setPreview3D(true)}>Open 3D preview</button>
                                <button className="px-3 py-2 bg-white border rounded" onClick={() => tryPolyfill()}>Try polyfill</button>
                            </div>
                        </div>
                    )}

                    {(xrSupported === true || preview3D) && (
                        <Canvas>
                            <XR store={store} inline={!xrSupported || preview3D}>
                                {texture ? (
                                    <>
                                        <PlacementHandler onPlace={(pos, rot) => { setTransform({ position: pos, rotation: rot }); setPlaced(true); }} />

                                        {showVideo ? (
                                            // show the video plane when toggled
                                            texture ? (
                                                <VideoMesh texture={texture} videoRef={videoRef} position={placed ? transform.position : transform.position} rotation={placed ? transform.rotation : transform.rotation} />
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
                                                        try { await vid.play(); } catch (e) {}
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
                <button className="px-3 py-1 bg-gray-200" onClick={() => { setPlaced(false); setTransform({ position: [0, 1.2, -1.5], rotation: [0, 0, 0] }); }}>
                    Reset placement
                </button>
            </div>

            <div className="mt-2 text-sm text-slate-500">
                The AR view will overlay the video onto a plane. Move your phone around to place it so the speaker appears in the room.
            </div>
        </div>
    );
}

function VideoMesh({ texture, videoRef }) {
    const meshRef = useRef();

    // update the video texture each frame so it shows animation in AR
    useFrame(() => {
        if (texture && texture.isVideoTexture) {
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
            <meshBasicMaterial toneMapped={false} map={texture} side={THREE.DoubleSide} />
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
            const meshQuat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, lookAt, new THREE.Vector3(0, 1, 0)));
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
