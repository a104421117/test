"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

const fs = require("fs");
const path = require("path");

// 解析 CSV
function parseCSV(content) {
    const lines = content.split("\n").filter((line) => line.trim());
    const results = [];
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const values = [];
        let current = "";
        let inQuotes = false;

        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === "," && !inQuotes) {
                values.push(current.trim());
                current = "";
            } else {
                current += char;
            }
        }
        values.push(current.trim());

        if (values.length >= 5) {
            let name, type, parentPath, x, y, width, height;
            
            if (values[1] === "layer" || values[1] === "group") {
                name = values[0].replace(/^"|"$/g, "");
                type = values[1];
                parentPath = values[2].replace(/^"|"$/g, "");
                x = parseFloat(values[3]);
                y = parseFloat(values[4]);
                width = values[5] ? parseFloat(values[5]) : undefined;
                height = values[6] ? parseFloat(values[6]) : undefined;
            } else {
                name = values[0].replace(/^"|"$/g, "");
                type = "layer";
                parentPath = "";
                x = parseFloat(values[1]);
                y = parseFloat(values[2]);
                width = values[3] ? parseFloat(values[3]) : undefined;
                height = values[4] ? parseFloat(values[4]) : undefined;
            }

            if (!isNaN(x) && !isNaN(y)) {
                results.push({ name, type, parentPath, x, y, width, height });
            }
        }
    }

    return results;
}

// 遞迴搜尋場景中的節點
async function findNodesInScene() {
    const results = {};
    
    try {
        const queryResult = await Editor.Message.request("scene", "query-node-tree", "");
        
        if (!queryResult) {
            return results;
        }

        async function searchNode(node, parentPath) {
            if (!node) return;
            
            const nodePath = parentPath ? parentPath + "/" + node.name : node.name;
            
            results[node.name] = results[node.name] || [];
            results[node.name].push({
                uuid: node.uuid,
                path: nodePath
            });

            if (node.children && node.children.length > 0) {
                for (const child of node.children) {
                    await searchNode(child, nodePath);
                }
            }
        }

        if (queryResult.children) {
            for (const child of queryResult.children) {
                await searchNode(child, "");
            }
        }
        
    } catch (e) {
        console.error("CSV Importer: 搜尋節點時發生錯誤", e);
    }

    return results;
}

// 獲取場景根節點 UUID (Canvas)
async function getSceneRootUuid() {
    try {
        const queryResult = await Editor.Message.request("scene", "query-node-tree", "");
        if (queryResult && queryResult.children && queryResult.children.length > 0) {
            for (const child of queryResult.children) {
                if (child.name === "Canvas") {
                    return child.uuid;
                }
            }
            return queryResult.children[0].uuid;
        }
        return queryResult ? queryResult.uuid : null;
    } catch (e) {
        console.error("CSV Importer: 獲取場景根節點失敗", e);
        return null;
    }
}

// 根據名稱找到父節點 UUID
async function findParentUuid(parentName, nodeMap) {
    if (!parentName) return null;
    
    const parts = parentName.split("/");
    const directParent = parts[parts.length - 1];
    
    if (nodeMap[directParent] && nodeMap[directParent].length > 0) {
        return nodeMap[directParent][0].uuid;
    }
    
    return null;
}

// 複製圖片到專案並記錄完整路徑
async function copyImagesToProject(imagesFolder, targetFolder, keepStructure) {
    const imageMap = {};
    
    if (!fs.existsSync(imagesFolder)) {
        console.log(`CSV Importer: 找不到 images 資料夾: ${imagesFolder}`);
        return imageMap;
    }

    // 建立目標資料夾
    if (!fs.existsSync(targetFolder)) {
        fs.mkdirSync(targetFolder, { recursive: true });
        console.log(`CSV Importer: 建立資料夾 ${targetFolder}`);
    }

    function copyRecursive(srcDir, destDir, relPath) {
        const items = fs.readdirSync(srcDir);
        
        for (const item of items) {
            const srcPath = path.join(srcDir, item);
            const stat = fs.statSync(srcPath);
            
            if (stat.isDirectory()) {
                const newDestDir = keepStructure ? path.join(destDir, item) : destDir;
                if (keepStructure && !fs.existsSync(newDestDir)) {
                    fs.mkdirSync(newDestDir, { recursive: true });
                }
                const newRelPath = relPath ? relPath + "/" + item : item;
                copyRecursive(srcPath, newDestDir, newRelPath);
            } else if (item.toLowerCase().endsWith(".png") || 
                       item.toLowerCase().endsWith(".jpg") || 
                       item.toLowerCase().endsWith(".jpeg")) {
                const destPath = path.join(destDir, item);
                fs.copyFileSync(srcPath, destPath);
                
                const nameWithoutExt = path.basename(item, path.extname(item));
                // 記錄完整的檔案系統路徑
                const fullPath = keepStructure && relPath 
                    ? path.join(destDir, item)
                    : path.join(destDir, item);
                    
                imageMap[nameWithoutExt] = {
                    filePath: destPath,
                    relativePath: (relPath ? relPath + "/" : "") + item
                };
                
                console.log(`CSV Importer: 複製圖片 ${item}`);
            }
        }
    }

    copyRecursive(imagesFolder, targetFolder, "");
    
    return imageMap;
}

// 刷新資源資料庫並等待完成
async function refreshAssetDBAndWait(targetFolder, projectPath) {
    try {
        // 計算 db:// 路徑
        const assetsPath = path.join(projectPath, "assets");
        let relativePath = targetFolder.replace(assetsPath, "").replace(/\\/g, "/");
        if (relativePath.startsWith("/")) {
            relativePath = relativePath.substring(1);
        }
        const dbPath = "db://assets/" + relativePath;
        
        console.log(`CSV Importer: 刷新資源 ${dbPath}`);
        
        // 刷新資源
        await Editor.Message.request("asset-db", "refresh-asset", dbPath);
        
        // 等待較長時間確保資源載入完成
        console.log("CSV Importer: 等待資源載入...");
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        return dbPath;
    } catch (e) {
        console.error("CSV Importer: 刷新資源資料庫失敗", e);
        return null;
    }
}

// 查找 SpriteFrame UUID - 改進版 v2
async function findSpriteFrameUuid(imageName, imageInfo, targetFolder, projectPath) {
    if (!imageInfo) {
        console.log(`CSV Importer: 找不到圖片資訊: ${imageName}`);
        return null;
    }

    try {
        // 計算 db:// 路徑
        const assetsPath = path.join(projectPath, "assets");
        let targetRelative = targetFolder.replace(assetsPath, "").replace(/\\/g, "/");
        if (targetRelative.startsWith("/")) {
            targetRelative = targetRelative.substring(1);
        }
        
        // 構建完整的 db 路徑
        const imageDbPath = "db://assets/" + targetRelative + "/" + imageInfo.relativePath;
        const spriteFrameDbPath = imageDbPath + "/spriteFrame";
        
        console.log(`CSV Importer: 圖片路徑: ${imageDbPath}`);
        console.log(`CSV Importer: SpriteFrame 路徑: ${spriteFrameDbPath}`);
        
        // 方法 1: 直接查找 spriteFrame 子資源
        try {
            const assetInfo = await Editor.Message.request("asset-db", "query-asset-info", spriteFrameDbPath);
            if (assetInfo && assetInfo.uuid) {
                console.log(`CSV Importer: ✓ 方法1成功 - UUID: ${assetInfo.uuid}`);
                return assetInfo.uuid;
            }
        } catch (e) {
            console.log(`CSV Importer: 方法1失敗: ${e.message}`);
        }
        
        // 方法 2: 查找圖片資源，獲取其 uuid
        try {
            const imageAssetInfo = await Editor.Message.request("asset-db", "query-asset-info", imageDbPath);
            console.log(`CSV Importer: 圖片資源資訊:`, JSON.stringify(imageAssetInfo));
            
            if (imageAssetInfo && imageAssetInfo.uuid) {
                // Cocos 3.x 的 spriteFrame 子資源 UUID 格式
                const spriteFrameUuid = imageAssetInfo.uuid + "@f9941";
                console.log(`CSV Importer: ✓ 方法2成功 - UUID: ${spriteFrameUuid}`);
                return spriteFrameUuid;
            }
        } catch (e) {
            console.log(`CSV Importer: 方法2失敗: ${e.message}`);
        }

        // 方法 3: 使用 query-asset-meta 獲取 subAssets
        try {
            const metaInfo = await Editor.Message.request("asset-db", "query-asset-meta", imageDbPath);
            console.log(`CSV Importer: Meta 資訊:`, JSON.stringify(metaInfo));
            
            if (metaInfo && metaInfo.subMetas) {
                for (const key in metaInfo.subMetas) {
                    const subMeta = metaInfo.subMetas[key];
                    if (subMeta.uuid) {
                        console.log(`CSV Importer: ✓ 方法3成功 - 子資源 ${key}: ${subMeta.uuid}`);
                        return subMeta.uuid;
                    }
                }
            }
        } catch (e) {
            console.log(`CSV Importer: 方法3失敗: ${e.message}`);
        }
        
        console.log(`CSV Importer: ✗ 所有方法都失敗: ${imageName}`);
        
    } catch (e) {
        console.error(`CSV Importer: 查找 SpriteFrame 錯誤: ${imageName}`, e);
    }

    return null;
}

// 建立帶有 Sprite 的節點
async function createNodeWithSprite(name, parentUuid, x, y, width, height, spriteFrameUuid) {
    try {
        const newNodeUuid = await Editor.Message.request("scene", "create-node", {
            parent: parentUuid,
            name: name
        });

        if (!newNodeUuid) {
            return null;
        }

        console.log(`CSV Importer: 建立節點 "${name}"`);
        
        await new Promise(resolve => setTimeout(resolve, 100));
        await setNodePosition(newNodeUuid, x, y);

        if (spriteFrameUuid) {
            await addSpriteComponent(newNodeUuid, spriteFrameUuid);
        }
        
        return newNodeUuid;
    } catch (e) {
        console.error(`CSV Importer: 建立節點失敗 "${name}"`, e);
        return null;
    }
}

// 添加 Sprite 組件並設定資源
async function addSpriteComponent(nodeUuid, spriteFrameUuid) {
    try {
        console.log(`CSV Importer: 添加 Sprite 組件到節點 ${nodeUuid}`);
        console.log(`CSV Importer: SpriteFrame UUID: ${spriteFrameUuid}`);
        
        // 添加 Sprite 組件
        await Editor.Message.request("scene", "create-component", {
            uuid: nodeUuid,
            component: "cc.Sprite"
        });
        
        await new Promise(resolve => setTimeout(resolve, 300));

        // 查詢節點，找到 Sprite 組件的索引
        const nodeInfo = await Editor.Message.request("scene", "query-node", nodeUuid);
        
        let spriteCompIndex = -1;
        
        if (nodeInfo && nodeInfo.__comps__) {
            console.log(`CSV Importer: 組件數量: ${nodeInfo.__comps__.length}`);
            for (let i = 0; i < nodeInfo.__comps__.length; i++) {
                const comp = nodeInfo.__comps__[i];
                if (comp.type === "cc.Sprite") {
                    spriteCompIndex = i;
                    console.log(`CSV Importer: 找到 Sprite 組件，索引: ${i}`);
                    break;
                }
            }
        }
        
        if (spriteCompIndex === -1) {
            console.log(`CSV Importer: ✗ 找不到 Sprite 組件`);
            return false;
        }

        // 使用 execute-scene-script 在場景中設定 spriteFrame
        const script = `
            const node = cc.director.getScene().getChildByUuid("${nodeUuid}") || 
                         cc.find("Canvas").getChildByUuid && cc.find("Canvas").getChildByUuid("${nodeUuid}");
            if (!node) {
                // 嘗試遞迴查找
                function findNodeByUuid(parent, uuid) {
                    if (!parent) return null;
                    if (parent.uuid === uuid) return parent;
                    for (let child of parent.children) {
                        const found = findNodeByUuid(child, uuid);
                        if (found) return found;
                    }
                    return null;
                }
                const scene = cc.director.getScene();
                const foundNode = findNodeByUuid(scene, "${nodeUuid}");
                if (foundNode) {
                    const sprite = foundNode.getComponent(cc.Sprite);
                    if (sprite) {
                        cc.assetManager.loadAny({ uuid: "${spriteFrameUuid}" }, (err, asset) => {
                            if (!err && asset) {
                                sprite.spriteFrame = asset;
                                sprite.sizeMode = 2; // RAW
                            }
                        });
                    }
                }
            } else {
                const sprite = node.getComponent(cc.Sprite);
                if (sprite) {
                    cc.assetManager.loadAny({ uuid: "${spriteFrameUuid}" }, (err, asset) => {
                        if (!err && asset) {
                            sprite.spriteFrame = asset;
                            sprite.sizeMode = 2; // RAW
                        }
                    });
                }
            }
        `;
        
        try {
            await Editor.Message.request("scene", "execute-scene-script", {
                name: "set-sprite",
                method: "run",
                args: [nodeUuid, spriteFrameUuid, spriteCompIndex]
            });
        } catch (e) {
            console.log(`CSV Importer: execute-scene-script 失敗，使用備用方案`);
        }

        // 備用方案：使用節點 UUID + 組件路徑設定屬性
        const compPath = `__comps__.${spriteCompIndex}`;
        console.log(`CSV Importer: 設定路徑: ${compPath}`);
        
        // 設定 spriteFrame - 嘗試簡化的 dump 格式
        const setResult = await Editor.Message.request("scene", "set-property", {
            uuid: nodeUuid,
            path: `${compPath}.spriteFrame`,
            dump: {
                type: "cc.SpriteFrame",
                value: {
                    uuid: spriteFrameUuid,
                    __expectedType__: "cc.SpriteFrame"
                }
            }
        });
        console.log(`CSV Importer: set-property spriteFrame 結果:`, setResult);

        // 如果失敗，嘗試另一種格式
        if (!setResult) {
            console.log(`CSV Importer: 嘗試另一種格式...`);
            const setResult2 = await Editor.Message.request("scene", "set-property", {
                uuid: nodeUuid,
                path: `${compPath}._spriteFrame`,
                dump: {
                    type: "cc.SpriteFrame",
                    value: {
                        uuid: spriteFrameUuid
                    }
                }
            });
            console.log(`CSV Importer: set-property _spriteFrame 結果:`, setResult2);
        }

        // 設定 sizeMode 為 RAW (嘗試兩種路徑)
        let setSizeResult = await Editor.Message.request("scene", "set-property", {
            uuid: nodeUuid,
            path: `${compPath}.sizeMode`,
            dump: {
                type: "cc.Sprite.SizeMode",
                value: 2
            }
        });
        
        if (!setSizeResult) {
            setSizeResult = await Editor.Message.request("scene", "set-property", {
                uuid: nodeUuid,
                path: `${compPath}._sizeMode`,
                dump: {
                    type: "Number",
                    value: 2
                }
            });
        }
        console.log(`CSV Importer: set-property sizeMode 結果:`, setSizeResult);

        console.log(`CSV Importer: ✓ 設定 Sprite 完成`);
        return true;
    } catch (e) {
        console.error(`CSV Importer: 設定 Sprite 失敗`, e);
        return false;
    }
}

// 設定節點座標
async function setNodePosition(uuid, x, y) {
    try {
        await Editor.Message.request("scene", "set-property", {
            uuid: uuid,
            path: "position",
            dump: {
                type: "cc.Vec3",
                value: { x: x, y: y, z: 0 }
            }
        });
        return true;
    } catch (e) {
        console.error(`CSV Importer: 設定座標失敗`, e);
        return false;
    }
}

// 為現有節點設定或更新 Sprite
async function setSpriteForNode(uuid, spriteFrameUuid) {
    try {
        // 查詢節點資訊
        const nodeInfo = await Editor.Message.request("scene", "query-node", uuid);
        
        let spriteCompIndex = -1;
        
        if (nodeInfo && nodeInfo.__comps__) {
            for (let i = 0; i < nodeInfo.__comps__.length; i++) {
                const comp = nodeInfo.__comps__[i];
                if (comp.type === "cc.Sprite") {
                    spriteCompIndex = i;
                    break;
                }
            }
        }

        // 如果沒有 Sprite 組件，添加一個
        if (spriteCompIndex === -1) {
            await Editor.Message.request("scene", "create-component", {
                uuid: uuid,
                component: "cc.Sprite"
            });
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // 重新查詢獲取組件索引
            const updatedInfo = await Editor.Message.request("scene", "query-node", uuid);
            if (updatedInfo && updatedInfo.__comps__) {
                for (let i = 0; i < updatedInfo.__comps__.length; i++) {
                    const comp = updatedInfo.__comps__[i];
                    if (comp.type === "cc.Sprite") {
                        spriteCompIndex = i;
                        break;
                    }
                }
            }
        }

        if (spriteCompIndex === -1) {
            console.log(`CSV Importer: ✗ 無法找到或建立 Sprite 組件`);
            return false;
        }

        console.log(`CSV Importer: Sprite 組件索引: ${spriteCompIndex}`);

        // 使用節點 UUID + 組件路徑設定屬性
        const compPath = `__comps__.${spriteCompIndex}`;
        
        // 設定 spriteFrame
        let setResult = await Editor.Message.request("scene", "set-property", {
            uuid: uuid,
            path: `${compPath}.spriteFrame`,
            dump: {
                type: "cc.SpriteFrame",
                value: {
                    uuid: spriteFrameUuid,
                    __expectedType__: "cc.SpriteFrame"
                }
            }
        });

        // 如果失敗，嘗試另一種格式
        if (!setResult) {
            setResult = await Editor.Message.request("scene", "set-property", {
                uuid: uuid,
                path: `${compPath}._spriteFrame`,
                dump: {
                    type: "cc.SpriteFrame",
                    value: {
                        uuid: spriteFrameUuid
                    }
                }
            });
        }

        // 設定 sizeMode 為 RAW
        let setSizeResult = await Editor.Message.request("scene", "set-property", {
            uuid: uuid,
            path: `${compPath}.sizeMode`,
            dump: {
                type: "cc.Sprite.SizeMode",
                value: 2
            }
        });
        
        if (!setSizeResult) {
            setSizeResult = await Editor.Message.request("scene", "set-property", {
                uuid: uuid,
                path: `${compPath}._sizeMode`,
                dump: {
                    type: "Number",
                    value: 2
                }
            });
        }

        console.log(`CSV Importer: ✓ 更新 Sprite 成功`);
        return true;
    } catch (e) {
        console.error(`CSV Importer: 設定 Sprite 失敗`, e);
        return false;
    }
}

// 主要匯入函數
async function doImport(csvPath, options) {
    let content;
    try {
        const buffer = fs.readFileSync(csvPath);
        content = buffer.toString("utf8").replace(/^\uFEFF/, "");
    } catch (e) {
        return { success: false, message: "無法讀取檔案: " + e.message };
    }

    const positions = parseCSV(content);
    if (positions.length === 0) {
        return { success: false, message: "CSV 檔案中沒有有效的座標資料" };
    }

    console.log(`CSV Importer: 解析到 ${positions.length} 筆資料`);

    let imageMap = {};
    
    if (options.importImages && options.imagesSourceFolder) {
        console.log(`CSV Importer: 開始複製圖片`);
        console.log(`  來源: ${options.imagesSourceFolder}`);
        console.log(`  目標: ${options.imagesTargetFolder}`);
        
        imageMap = await copyImagesToProject(
            options.imagesSourceFolder, 
            options.imagesTargetFolder, 
            true
        );
        
        console.log(`CSV Importer: 複製了 ${Object.keys(imageMap).length} 張圖片`);
        
        // 刷新資源並等待
        await refreshAssetDBAndWait(options.imagesTargetFolder, options.projectPath);
        
        // 額外等待確保資源完全載入
        console.log("CSV Importer: 額外等待資源載入...");
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    let nodeMap = await findNodesInScene();
    
    const sceneRootUuid = await getSceneRootUuid();
    if (!sceneRootUuid) {
        return { success: false, message: "無法獲取場景根節點，請確認場景已打開且有 Canvas" };
    }

    let updated = 0;
    let created = 0;
    let imagesSet = 0;
    let failed = [];

    console.log("CSV Importer: CSV 順序:", positions.map(p => p.name).join(" → "));

    // 按父節點分組，保持 CSV 順序
    const byParent = {};
    for (const pos of positions) {
        const parent = pos.parentPath || "__root__";
        if (!byParent[parent]) byParent[parent] = [];
        byParent[parent].push(pos);
    }
    
    console.log("CSV Importer: 父節點分組:", Object.keys(byParent));
    for (const parent in byParent) {
        console.log(`CSV Importer:   ${parent}: ${byParent[parent].map(p => p.name).join(" → ")}`);
    }

    // 遞迴處理函數 - 按 CSV 順序建立每個父節點下的子節點
    async function processParent(parentPath, parentUuid) {
        const items = byParent[parentPath] || [];
        
        for (const pos of items) {
            const existingNodes = nodeMap[pos.name];
            
            // 查找對應的圖片
            let spriteFrameUuid = null;
            if (pos.type !== "group" && options.importImages && imageMap[pos.name]) {
                spriteFrameUuid = await findSpriteFrameUuid(
                    pos.name, 
                    imageMap[pos.name], 
                    options.imagesTargetFolder,
                    options.projectPath
                );
            }
            
            if (existingNodes && existingNodes.length > 0) {
                // 更新現有節點
                if (options.updatePosition !== false) {
                    await setNodePosition(existingNodes[0].uuid, pos.x, pos.y);
                }
                
                if (spriteFrameUuid) {
                    const success = await setSpriteForNode(existingNodes[0].uuid, spriteFrameUuid);
                    if (success) imagesSet++;
                }
                
                updated++;
                
                // 如果是群組，遞迴處理子節點
                if (pos.type === "group") {
                    await processParent(pos.name, existingNodes[0].uuid);
                }
            } else if (options.autoCreate) {
                // 建立新節點
                const newUuid = await createNodeWithSprite(
                    pos.name, 
                    parentUuid, 
                    pos.x, pos.y, 
                    pos.width, pos.height, 
                    spriteFrameUuid
                );
                
                if (newUuid) {
                    created++;
                    nodeMap[pos.name] = [{ uuid: newUuid, path: pos.name }];
                    if (spriteFrameUuid) imagesSet++;
                    
                    // 如果是群組，遞迴處理子節點
                    if (pos.type === "group") {
                        await processParent(pos.name, newUuid);
                    }
                } else {
                    failed.push(pos.name);
                }
            } else {
                failed.push(pos.name);
            }
        }
    }
    
    // 從根節點開始遞迴處理
    await processParent("__root__", sceneRootUuid);

    console.log("CSV Importer: 節點建立完成");

    return {
        success: true,
        updated: updated,
        created: created,
        imagesSet: imagesSet,
        failed: failed,
        total: positions.length,
        imagesCount: Object.keys(imageMap).length,
        targetFolder: options.imagesTargetFolder || ""
    };
}

// 根據 CSV 順序重新排列節點
async function reorderNodesByCsvOrder(positions, nodeMap) {
    try {
        console.log("CSV Importer: 開始重新排列節點順序...");
        
        // 按照父路徑分組，保持 CSV 順序
        const nodesByParent = {};
        const parentUuids = {};  // 記錄父節點 UUID
        
        for (let i = 0; i < positions.length; i++) {
            const pos = positions[i];
            const parentPath = pos.parentPath || "__root__";
            
            if (!nodesByParent[parentPath]) {
                nodesByParent[parentPath] = [];
            }
            
            // 查找節點 UUID
            const nodes = nodeMap[pos.name];
            if (nodes && nodes.length > 0) {
                nodesByParent[parentPath].push({
                    uuid: nodes[0].uuid,
                    name: pos.name,
                    csvIndex: i
                });
            }
            
            // 如果是群組，記錄其 UUID（使用完整路徑作為 key）
            if (pos.type === "group" && nodes && nodes.length > 0) {
                const fullPath = parentPath === "__root__" ? pos.name : parentPath + "/" + pos.name;
                parentUuids[fullPath] = nodes[0].uuid;
                parentUuids[pos.name] = nodes[0].uuid;  // 也用名稱作為 key
            }
        }
        
        // 獲取 Canvas UUID 作為根節點
        const sceneRootUuid = await getSceneRootUuid();
        parentUuids["__root__"] = sceneRootUuid;
        
        console.log("CSV Importer: 父節點分組:", Object.keys(nodesByParent));
        
        // 對每個父節點下的子節點重新排序
        // CSV 順序已經是期望的 Cocos 順序，直接按 CSV 順序排列
        for (const parentPath in nodesByParent) {
            const children = nodesByParent[parentPath];
            
            if (children.length <= 1) {
                console.log(`CSV Importer: "${parentPath}" 只有 ${children.length} 個節點，跳過排序`);
                continue;
            }
            
            const parentUuid = parentPath === "__root__" ? sceneRootUuid : parentUuids[parentPath];
            if (!parentUuid) {
                console.log(`CSV Importer: 找不到父節點 "${parentPath}" 的 UUID`);
                continue;
            }
            
            console.log(`CSV Importer: 排列 "${parentPath}" 下的 ${children.length} 個節點`);
            console.log(`CSV Importer: CSV 順序: ${children.map(c => c.name).join(" → ")}`);
            
            // 按 CSV 順序設置 siblingIndex（不反轉）
            for (let targetIndex = 0; targetIndex < children.length; targetIndex++) {
                const child = children[targetIndex];
                
                // 方法 1: 嘗試使用 move-node
                let success = false;
                try {
                    const moveResult = await Editor.Message.request("scene", "move-node", {
                        uuid: child.uuid,
                        parent: parentUuid,
                        index: targetIndex
                    });
                    success = moveResult !== false;
                    console.log(`CSV Importer: move-node "${child.name}" 到位置 ${targetIndex}: ${success ? '成功' : '失敗'}`);
                } catch (e) {
                    console.log(`CSV Importer: move-node "${child.name}" 失敗: ${e.message || e}`);
                }
                
                // 方法 2: 如果 move-node 失敗，嘗試 set-property siblingIndex
                if (!success) {
                    try {
                        const setResult = await Editor.Message.request("scene", "set-property", {
                            uuid: child.uuid,
                            path: "siblingIndex",
                            dump: { 
                                type: "Number", 
                                value: targetIndex 
                            }
                        });
                        console.log(`CSV Importer: set-property siblingIndex "${child.name}" = ${targetIndex}: ${setResult}`);
                    } catch (e2) {
                        console.log(`CSV Importer: set-property siblingIndex "${child.name}" 失敗: ${e2.message || e2}`);
                    }
                }
                
                // 加入小延遲確保操作完成
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
        
        console.log("CSV Importer: 節點排序完成");
    } catch (e) {
        console.error("CSV Importer: 排序節點失敗", e);
    }
}

// 獲取專案路徑
function getProjectPath() {
    try {
        return Editor.Project.path;
    } catch (e) {
        console.error("CSV Importer: 獲取專案路徑失敗", e);
        return null;
    }
}

module.exports = {
    load() {
        console.log("CSV Position Importer v7.3 已載入");
    },

    unload() {
        console.log("CSV Position Importer v7.3 已卸載");
    },

    methods: {
        async openPanel() {
            console.log("CSV Importer: 開啟檔案選擇對話框");

            // 步驟 1: 選擇 CSV 檔案
            const result = await Editor.Dialog.select({
                title: "步驟 1：選擇 CSV 座標檔案",
                path: "",
                type: "file",
                filters: [
                    { name: "CSV 檔案", extensions: ["csv"] },
                    { name: "所有檔案", extensions: ["*"] }
                ]
            });

            if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
                return;
            }

            const csvPath = result.filePaths[0];
            const csvDir = path.dirname(csvPath);
            const defaultImagesFolder = path.join(csvDir, "images");
            const hasDefaultImages = fs.existsSync(defaultImagesFolder);

            // 詢問匯入模式
            let detailMsg = `CSV 檔案：${path.basename(csvPath)}\n\n`;
            
            if (hasDefaultImages) {
                detailMsg += `✓ 偵測到 images 資料夾\n\n`;
            }
            
            detailMsg += `請選擇匯入模式：`;

            const modeButtons = ["取消", "更新節點 + 圖片", "僅更新節點"];

            const modeConfirm = await Editor.Dialog.info("匯入 CSV 座標", {
                detail: detailMsg,
                buttons: modeButtons,
                default: 1,
                cancel: 0
            });

            if (modeConfirm.response === 0) return;

            // 模式：1 = 更新節點+圖片，2 = 僅更新節點
            const updateNodes = true;  // 兩種模式都更新節點
            const wantImages = modeConfirm.response === 1;

            let imagesSourceFolder = null;
            let imagesTargetFolder = null;
            const projectPath = getProjectPath();

            // 需要圖片時才選擇圖片資料夾
            if (wantImages) {
                // 選擇圖片來源資料夾
                const sourceResult = await Editor.Dialog.select({
                    title: "選擇圖片來源資料夾",
                    path: hasDefaultImages ? defaultImagesFolder : csvDir,
                    type: "directory"
                });

                if (!sourceResult.canceled && sourceResult.filePaths && sourceResult.filePaths.length > 0) {
                    imagesSourceFolder = sourceResult.filePaths[0];

                    // 選擇圖片目標資料夾（專案內）
                    const defaultTargetFolder = path.join(projectPath, "assets", "imported-ui");

                    const targetResult = await Editor.Dialog.select({
                        title: "選擇圖片匯入目標資料夾（專案 assets 內）",
                        path: path.join(projectPath, "assets"),
                        type: "directory"
                    });

                    if (!targetResult.canceled && targetResult.filePaths && targetResult.filePaths.length > 0) {
                        imagesTargetFolder = targetResult.filePaths[0];
                    } else {
                        imagesTargetFolder = defaultTargetFolder;
                    }

                    // 確認目標資料夾在 assets 內
                    if (!imagesTargetFolder.includes("assets")) {
                        await Editor.Dialog.warn("警告", {
                            detail: "目標資料夾必須在專案的 assets 資料夾內！\n將使用預設資料夾：assets/imported-ui/"
                        });
                        imagesTargetFolder = defaultTargetFolder;
                    }
                }
            }

            // 最終確認
            let confirmMsg = `即將執行：\n\n`;
            confirmMsg += `• CSV: ${path.basename(csvPath)}\n`;
            
            if (wantImages && imagesSourceFolder) {
                confirmMsg += `• 模式: 更新節點 + 圖片\n`;
                confirmMsg += `• 圖片來源: ${path.basename(imagesSourceFolder)}/\n`;
                confirmMsg += `• 匯入目標: ${imagesTargetFolder.split("assets")[1] || "/imported-ui"}\n`;
            } else {
                confirmMsg += `• 模式: 僅更新節點\n`;
            }

            const finalConfirm = await Editor.Dialog.info("確認匯入", {
                detail: confirmMsg,
                buttons: ["取消", "開始匯入"],
                default: 1,
                cancel: 0
            });

            if (finalConfirm.response === 0) return;

            // 執行匯入
            console.log(`CSV Importer: 開始匯入`);

            const importResult = await doImport(csvPath, {
                autoCreate: true,
                updatePosition: true,
                importImages: !!(imagesSourceFolder && imagesTargetFolder),
                imagesSourceFolder: imagesSourceFolder,
                imagesTargetFolder: imagesTargetFolder,
                projectPath: projectPath
            });

            if (!importResult.success) {
                await Editor.Dialog.error("匯入失敗", {
                    detail: importResult.message
                });
                return;
            }

            let detail = "";
            
            if (importResult.updated > 0) {
                detail += `✓ 更新 ${importResult.updated} 個節點\n`;
            }
            
            if (importResult.created > 0) {
                detail += `✓ 建立 ${importResult.created} 個新節點\n`;
            }
            
            if (importResult.imagesSet > 0) {
                detail += `✓ 設定 ${importResult.imagesSet} 個 Sprite\n`;
            }

            if (importResult.imagesCount > 0) {
                detail += `✓ 匯入 ${importResult.imagesCount} 張圖片\n`;
            }
            
            if (importResult.failed.length > 0) {
                detail += `\n⚠️ 找不到 ${importResult.failed.length} 個節點\n`;
            }

            if (importResult.updated === 0 && importResult.created === 0 && importResult.imagesSet === 0) {
                detail = "沒有任何更新。\n\n請確認：\n• 場景中有對應名稱的節點\n• 圖片資料夾包含對應圖片";
            } else {
                detail += "\n⚠️ 請記得儲存場景！";
            }

            await Editor.Dialog.info("匯入完成", {
                detail: detail,
                buttons: ["確定"]
            });
        },

        async importCSV(csvPath, options = {}) {
            return await doImport(csvPath, options);
        }
    }
};
