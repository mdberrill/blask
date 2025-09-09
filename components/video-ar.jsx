'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { XR, createXRStore } from '@react-three/xr';
import * as THREE from 'three';

const store = createXRStore();

export default function VideoAR({ videoSrc }) {
    const videoRef = useRef(null);
    const [texture, setTexture] = useState(null);
    const [playing, setPlaying] = useState(false);
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
        vid.style.position = 'absolute';
        vid.style.left = '-9999px';
        vid.style.width = '1px';
        vid.style.height = '1px';
        document.body.appendChild(vid);

        let createdTex = null;

        function handleCanPlay() {
            const tex = new THREE.VideoTexture(vid);
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.format = THREE.RGBAFormat;
            tex.premultiplyAlpha = false;
            createdTex = tex;
            setTexture(tex);
            vid.play()
                .then(() => setPlaying(true))
                .catch(() => setPlaying(false));
        }

        vid.addEventListener('canplay', handleCanPlay);
        videoRef.current = vid;

        return () => {
            vid.pause();
            vid.removeEventListener('canplay', handleCanPlay);
            if (createdTex) {
                try {
                    createdTex.dispose();
                } catch (e) {}
            }
            try {
                if (vid.parentNode) vid.parentNode.removeChild(vid);
            } catch (e) {}
        };
    }, [videoSrc]);

    useEffect(() => {
        const vid = videoRef.current;
        if (!vid) return;
        if (playing) vid.play().catch(() => {});
        else vid.pause();
    }, [playing]);

    function enterAR() {
        const vid = videoRef.current;
        const tryPlay = vid ? vid.play().catch(() => {}) : Promise.resolve();
        tryPlay.finally(() => {
            setTimeout(() => {
                if (xrSupported) store.enterAR();
                else setPreview3D(true);
            }, 150);
        });
    }

    useEffect(() => {
        async function check() {
            try {
                if (navigator.xr && navigator.xr.isSessionSupported) {
                    const supported = await navigator.xr.isSessionSupported('immersive-ar');
                    setXrSupported(!!supported);
                    return;
                }
            } catch (e) {}
            setXrSupported(false);
        }
        check();
    }, []);

    return (
        <div>
            <div className="mb-2">
                <button className="px-3 py-2 bg-sky-600 text-white rounded" onClick={enterAR}>
                    View in AR
                </button>
            </div>

            <div style={{ width: '100%', height: '60vh', maxWidth: 640 }}>
                {xrSupported === false && !preview3D && (
                    <div className="p-4 border rounded bg-yellow-50">
                        <div className="mb-2 font-medium">WebXR not supported on this device/browser</div>
                        <div className="text-sm mb-3">You can still preview the scene inline.</div>
                        <div className="flex gap-2">
                            <button
                                className="px-3 py-2 bg-sky-600 text-white rounded"
                                onClick={() => setPreview3D(true)}
                            >
                                Open 3D preview
                            </button>
                        </div>
                    </div>
                )}

                {(xrSupported === true || preview3D) && (
                    <Canvas gl={{ alpha: true, preserveDrawingBuffer: false }}>
                        <XR store={store} inline={!xrSupported || preview3D}>
                            {texture ? (
                                <VideoPlane texture={texture} videoRef={videoRef} />
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
        </div>
    );
}

function VideoPlane({ texture, videoRef }) {
    const meshRef = useRef();
    const { camera } = useThree();
    const [size, setSize] = useState([1.6, 0.9]);
    const [placed, setPlaced] = useState(false);

    useFrame(() => {
        if (texture) texture.needsUpdate = true;
        // while not placed, make the plane follow the camera so it appears 1.5m ahead
        if (!placed && camera) {
            const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
            const pos = new THREE.Vector3().copy(camera.position).add(dir.multiplyScalar(1.5));
            meshRef.current.position.copy(pos);
            // face the camera
            meshRef.current.quaternion.setFromRotationMatrix(
                new THREE.Matrix4().lookAt(meshRef.current.position, camera.position, new THREE.Vector3(0, 1, 0))
            );
        }
    });

    useEffect(() => {
        const v = videoRef.current;
        if (v && v.videoWidth && v.videoHeight) {
            const aspect = v.videoWidth / v.videoHeight;
            const height = 1.0;
            const width = height * aspect;
            setSize([width, height]);
        }
    }, [videoRef]);

    // lock placement when user taps / selects in XR (user expectation: tap to keep)
    useEffect(() => {
        function handleClick() {
            setPlaced(true);
        }
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, []);

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
