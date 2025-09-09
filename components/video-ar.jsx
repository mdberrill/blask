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
    const [keyMode, setKeyMode] = useState('auto'); // 'alpha' | 'chroma' | 'none' | 'auto'

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

        async function handleCanPlay() {
            // create video texture
            const tex = new THREE.VideoTexture(vid);
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.format = THREE.RGBAFormat;
            tex.premultiplyAlpha = false;
            createdTex = tex;
            setTexture(tex);

            // draw one sample frame to an offscreen canvas to detect green-screen or alpha
            try {
                const w = vid.videoWidth || 640;
                const h = vid.videoHeight || 360;
                const sampleW = Math.max(1, Math.round(w / 8));
                const sampleH = Math.max(1, Math.round(h / 8));
                const c = document.createElement('canvas');
                c.width = sampleW;
                c.height = sampleH;
                const ctx = c.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(vid, 0, 0, sampleW, sampleH);
                const img = ctx.getImageData(0, 0, sampleW, sampleH).data;
                let foundAlpha = false;
                let foundGreen = false;
                // sample a few pixels
                for (let y = 0; y < sampleH; y++) {
                    for (let x = 0; x < sampleW; x++) {
                        const i = (y * sampleW + x) * 4;
                        const r = img[i],
                            g = img[i + 1],
                            b = img[i + 2],
                            a = img[i + 3];
                        if (a && a < 250) foundAlpha = true;
                        if (g > 100 && g > r * 1.2 && g > b * 1.2) foundGreen = true;
                        if (foundAlpha || foundGreen) break;
                    }
                    if (foundAlpha || foundGreen) break;
                }

                if (foundAlpha) setKeyMode('alpha');
                else if (foundGreen) setKeyMode('chroma');
                else setKeyMode('none');
            } catch (e) {
                setKeyMode('none');
            }

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
                                <VideoPlane texture={texture} videoRef={videoRef} keyMode={keyMode} />
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

function VideoPlane({ texture, videoRef, keyMode = 'auto' }) {
    const meshRef = useRef();
    const { camera } = useThree();
    const [size, setSize] = useState([1.6, 0.9]);
    const [placed, setPlaced] = useState(false);
    const [material, setMaterial] = useState(null);

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

    // create a ShaderMaterial for chroma keying the video texture only when requested
    useEffect(() => {
        if (!texture) return;
        if (keyMode !== 'chroma') return;

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTexture: { value: texture },
                keyColor: { value: new THREE.Color(0x00ff00) },
                similarity: { value: 0.35 },
                smoothness: { value: 0.08 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D uTexture;
                uniform vec3 keyColor;
                uniform float similarity;
                uniform float smoothness;
                varying vec2 vUv;

                void main() {
                    vec4 color = texture2D(uTexture, vUv);
                    float chromaDist = distance(color.rgb, keyColor);
                    float chromaAlpha = smoothstep(similarity, similarity + smoothness, chromaDist);
                    float outAlpha = color.a * chromaAlpha;
                    gl_FragColor = vec4(color.rgb, outAlpha);
                }
            `,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            alphaTest: 0.01
        });

        setMaterial(mat);

        return () => {
            try {
                mat.dispose();
            } catch (e) {}
            setMaterial(null);
        };
    }, [texture, keyMode]);

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
            {keyMode === 'chroma' && material ? (
                <primitive object={material} attach="material" />
            ) : keyMode === 'alpha' ? (
                <meshBasicMaterial
                    toneMapped={false}
                    map={texture}
                    side={THREE.DoubleSide}
                    transparent={true}
                    alphaTest={0.01}
                    depthWrite={false}
                />
            ) : (
                <meshBasicMaterial toneMapped={false} map={texture} />
            )}
        </mesh>
    );
}
