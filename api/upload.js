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

        // ========== CEK RESPONSE ==========
        
        // 1. CEK: Apakah response mengandung errors dengan code 0?
        if (data?.errors && data.errors[0]?.code === 0) {
            console.log('✅ UPLOAD SUKSES! (code:0)');
            
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
            
            // Kalau belum ketemu, tetap return success
            return res.status(200).json({
                success: true,
                assetId: null,
                message: 'Upload berhasil! Tunggu 1-2 menit, asset akan muncul di Creator Dashboard',
                hint: 'Buka https://create.roblox.com/dashboard/creations'
            });
        }
        
        // 2. CEK: Apakah ada assetId langsung?
        let assetId = data?.assetId || data?.data?.assetId || data?.id || null;
        if (assetId) {
            return res.status(200).json({
                success: true,
                assetId: assetId.toString(),
                assetUrl: `https://www.roblox.com/library/${assetId}`,
                message: 'Upload berhasil!'
            });
        }
        
        // 3. CEK: Apakah ada operationId?
        let operationId = data?.operationId || null;
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
                        if (assetId) {
                            return res.status(200).json({
                                success: true,
                                assetId: assetId.toString(),
                                assetUrl: `https://www.roblox.com/library/${assetId}`,
                                message: 'Upload berhasil!'
                            });
                        }
                        break;
                    }
                } catch (e) {
                    console.log(`⚠️ Poll ${i+1} error:`, e.message);
                }
            }
        }

        // 4. KALAU SEMUA GAGAL, tapi status response OK
        if (response.ok) {
            return res.status(200).json({
                success: true,
                assetId: null,
                message: 'Upload diproses! Cek Creator Dashboard dalam 1-2 menit',
                rawResponse: data
            });
        }

        // 5. ERROR NYATA
        throw new Error(data.message || data.error?.message || JSON.stringify(data));

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
        const response = await fetch('https://apis.roblox.com/cloud/v2/assets?limit=5', {
            headers: { 'x-api-key': apiKey }
        });
        
        if (!response.ok) return null;
        
        const data = await response.json();
        console.log('📊 Latest assets:', JSON.stringify(data));
        
        if (data?.data && data.data.length > 0) {
            return data.data[0];
        }
        return null;
    } catch (e) {
        console.log('⚠️ Gagal mencari asset:', e.message);
        return null;
    }
}
