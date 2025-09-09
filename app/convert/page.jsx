'use client';
import React, { useState, useRef } from 'react';
import convertVideoBackground from '../../utils/convertVideoBackground';
import VideoAR from '../../components/video-ar';

export default function ConvertPage() {
    const [sourceUrl, setSourceUrl] = useState(null);
    const [convertedUrl, setConvertedUrl] = useState(null);
    const [progress, setProgress] = useState(0);
    const [processing, setProcessing] = useState(false);
    const fileInputRef = useRef();

    const onFile = async (file) => {
        if (!file) return;
        setConvertedUrl(null);
        setProgress(0);
        setProcessing(false);

        const url = URL.createObjectURL(file);
        setSourceUrl(url);
    };

    const convert = async () => {
        if (!sourceUrl) return;
        setProcessing(true);
        setProgress(0);
        try {
            const blob = await convertVideoBackground(sourceUrl, {
                backgroundColor: '#00ff00',
                onProgress: (p) => setProgress(p)
            });
            const converted = URL.createObjectURL(blob);
            setConvertedUrl(converted);
        } catch (err) {
            console.error(err);
            alert('Conversion failed: ' + (err.message || err));
        } finally {
            setProcessing(false);
        }
    };

    const reset = () => {
        setSourceUrl(null);
        setConvertedUrl(null);
        setProgress(0);
        setProcessing(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const [showAr, setShowAr] = useState(false);

    return (
        <div style={{ padding: 24 }}>
            <h1>Convert video background</h1>
            <p>Upload a video, we remove the background and show it on a green background.</p>

            <div style={{ margin: '12px 0' }}>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/*"
                    onChange={(e) => onFile(e.target.files && e.target.files[0])}
                />
            </div>

            {sourceUrl && (
                <div style={{ marginBottom: 12 }}>
                    <h3>Source preview</h3>
                    <video src={sourceUrl} controls style={{ maxWidth: '100%' }} />
                </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button onClick={convert} disabled={!sourceUrl || processing}>
                    {processing ? 'Processing...' : 'Convert'}
                </button>
                <button onClick={reset}>Upload new</button>
            </div>

            {processing && (
                <div>
                    <div style={{ width: 300, background: '#eee' }}>
                        <div style={{ width: `${progress * 100}%`, height: 8, background: '#36c' }} />
                    </div>
                    <div>{Math.round(progress * 100)}%</div>
                </div>
            )}

            {convertedUrl && (
                <div style={{ marginTop: 12 }}>
                    <h3>Converted</h3>
                    <div style={{ background: '#00ff00', display: 'inline-block', padding: 8 }}>
                        <video src={convertedUrl} controls style={{ maxWidth: '100%' }} />
                    </div>
                    <div style={{ marginTop: 8 }}>
                        <a href={convertedUrl} download="converted.webm">
                            Download video
                        </a>
                    </div>
                    <div style={{ marginTop: 8 }}>
                        <button onClick={() => setShowAr((s) => !s)} disabled={!convertedUrl}>
                            {showAr ? 'Hide AR' : 'View in AR'}
                        </button>
                    </div>

                    {showAr && <div style={{ marginTop: 12 }}><VideoAR videoSrc={convertedUrl} /></div>}
                </div>
            )}
        </div>
    );
}
