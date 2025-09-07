'use client';

import React, { useState } from 'react';
import UploadAR from '../../components/upload-ar';

export default function UploadPage() {
    const [videoSrc, setVideoSrc] = useState(null);
    const [fileName, setFileName] = useState('');

    function onFile(e) {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        setFileName(f.name);
        const url = URL.createObjectURL(f);
        setVideoSrc(url);
    }

    return (
        <div className="px-6 py-8">
            <h1 className="text-2xl mb-4">Upload talk video (full body)</h1>

            <p className="mb-4 text-sm text-slate-600">
                Choose a short video of a stationary person giving a talk. For best results the whole body should be visible and the camera should be steady.
            </p>

            <input type="file" accept="video/*" onChange={onFile} />

            {videoSrc && (
                <div className="mt-6 space-y-4">
                    <div>
                        <strong>Selected:</strong> {fileName}
                    </div>
                    <video
                        src={videoSrc}
                        controls
                        playsInline
                        className="w-full max-w-md border"
                    />

                    <div className="mt-4">
                        <UploadAR videoSrc={videoSrc} />
                    </div>
                </div>
            )}
        </div>
    );
}
