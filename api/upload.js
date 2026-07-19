const FormData = require('form-data');
const fetch = require('node-fetch');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method Not Allowed' });
    }

    const API_KEY = process.env.ROBLOX_API_KEY;
    if (!API_KEY) {
        return res.status(500).json({ success: false, error: 'API_KEY missing' });
    }

    try {
        const { fileData, fileName, assetName, description } = req.body;

        if (!fileData) {
            return res.status(400).json({ success: false, error: 'fileData is required' });
        }

        const cleanBase64 = fileData.replace(/\s/g, '').replace(/\n/g, '').replace(/\r/g, '');
        const fileBuffer = Buffer.from(cleanBase64, 'base64');

        if (fileBuffer.length < 10) {
            return res.status(400).json({ success: false, error: 'File terlalu kecil' });
        }

        console.log(`📤 Upload: ${fileName || 'model.rbxm'}, ${fileBuffer.length} bytes`);

        const form = new FormData();
        
        const assetMetadata = {
            creator: {
                type: process.env.CREATOR_TYPE || 'user',
                id: parseInt(process.env.CREATOR_ID || '8380483098')
            },
            assetType: 'Model',
            displayName: assetName || fileName || `Model_${Date.now()}`,
            description: description || 'Uploaded from Delta'
        };
        
        form.append('request', JSON.stringify(assetMetadata));
        form.append('fileContent', fileBuffer, {
            filename: fileName || 'model.rbxm',
            contentType: 'model/x-rbxm'
        });

        const response = await fetch('https://apis.roblox.com/cloud/v2/assets', {
            method: 'POST',
            headers: {
                'x-api-key': API_KEY,
                ...form.getHeaders()
            },
            body: form
        });

        const responseText = await response.text();
        let data;
        try {
            data = JSON.parse(responseText);
        } catch {
            throw new Error('Invalid JSON response');
        }

        console.log('📄 Response:', JSON.stringify(data));

        // ========== CEK ERROR ==========
        if (!response.ok) {
            const errorMsg = data.message || data.error?.message || JSON.stringify(data);
            throw new Error(errorMsg);
        }

        // ========== CEK ASSET ID ==========
        let assetId = data?.assetId || data?.data?.assetId || data?.id || null;
        let operationId = data?.operationId || null;

        // ========== POLLING ==========
        if (operationId) {
            console.log(`⏳ Polling: ${operationId}`);
            for (let i = 0; i < 15; i++) {
                await new Promise(resolve => setTimeout(resolve, 3000));
                try {
                    const pollRes = await fetch(`https://apis.roblox.com/cloud/v2/operations/${operationId}`, {
                        headers: { 'x-api-key': API_KEY }
                    });
                    const pollData = await pollRes.json();
                    console.log(`📊 Poll ${i+1}:`, JSON.stringify(pollData));
                    
                    if (pollData?.done === true) {
                        if (pollData.error) {
                            throw new Error(`Polling error: ${pollData.error.message}`);
                        }
                        assetId = pollData?.response?.assetId || pollData?.result?.assetId || null;
                        break;
                    }
                } catch (e) {
                    console.log(`⚠️ Poll ${i+1} error:`, e.message);
                }
            }
        }

        // ========== KALAU CODE 0 ==========
        if (!assetId && data?.errors && data.errors[0]?.code === 0) {
            console.log('✅ Upload sukses (code:0), mencari asset terbaru...');
            
            // Coba cari asset terbaru
            const latestAsset = await findLatestAsset(API_KEY);
            if (latestAsset && latestAsset.id) {
                return res.status(200).json({
                    success: true,
                    assetId: latestAsset.id.toString(),
                    assetUrl: `https://www.roblox.com/library/${latestAsset.id}`,
                    message: 'Upload berhasil! Asset ditemukan.',
                    assetName: latestAsset.displayName
                });
            }
            
            // Kalau belum ketemu, kasih tahu user
            return res.status(200).json({
                success: true,
                assetId: null,
                message: 'Upload berhasil! Tunggu 1-2 menit lalu refresh dashboard.',
                rawResponse: data
            });
        }

        // ========== RESPONSE FINAL ==========
        if (assetId) {
            return res.status(200).json({
                success: true,
                assetId: assetId.toString(),
                assetUrl: `https://www.roblox.com/library/${assetId}`,
                message: 'Upload berhasil!'
            });
        } else {
            return res.status(200).json({
                success: true,
                assetId: null,
                message: 'Upload diproses! Cek Creator Dashboard dalam 1-2 menit',
                rawResponse: data
            });
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

// ========== FUNGSI MENCARI ASSET TERBARU ==========
async function findLatestAsset(apiKey) {
    try {
        // Coba cari asset terbaru milik creator
        const response = await fetch('https://apis.roblox.com/cloud/v2/assets?limit=5&order=desc', {
            headers: { 'x-api-key': apiKey }
        });
        
        if (!response.ok) return null;
        
        const data = await response.json();
        console.log('📊 Latest assets:', JSON.stringify(data));
        
        if (data?.data && data.data.length > 0) {
            // Ambil asset paling baru
            return data.data[0];
        }
        return null;
    } catch (e) {
        console.log('⚠️ Gagal mencari asset:', e.message);
        return null;
    }
}
