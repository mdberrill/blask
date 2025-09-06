'use client';

import { Canvas } from '@react-three/fiber';
import { XR, createXRStore } from '@react-three/xr';
import { useState } from 'react';

const store = createXRStore();

export function XrTest() {
    const [red, setRed] = useState(false);
    return (
        <>
            <h1 className="mb-8">XR</h1>
            <button onClick={() => store.enterAR()}>Enter AR</button>
            <Canvas>
                <XR store={store}>
                    <mesh pointerEventsType={{ deny: 'grab' }} onClick={() => setRed(!red)} position={[0, 1, -1]}>
                        <boxGeometry />
                        <meshBasicMaterial color={red ? 'red' : 'blue'} />
                    </mesh>
                </XR>
            </Canvas>
        </>
    );
}
