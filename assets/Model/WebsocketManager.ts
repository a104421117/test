import { error, log } from "cc";
import { BaseModel } from "../Base/BaseModel";
import { Room, RoomMap } from "./WebsocketModel";

export class WebsocketManager extends BaseModel.GameEvent<Room, RoomMap> {
    private ws: WebSocket = null;
    private static instance: WebsocketManager = null;
    public static getInstance() {
        if (this.instance === null) {
            error("[WebSocket] null");
        } else {
            return this.instance;
        }
    }

    public constructor(url: string, open: Function, close: Function) {
        super();
        WebsocketManager.instance = this;
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            log('[WebSocket] 連線成功');
            open(this.ws);
        };

        this.ws.onmessage = (event: MessageEvent) => {
            const msg = JSON.parse(event.data);
            const cmd: ServerRoomType = msg.cmd;
            if (cmd in ServerRoomType) {
                this.eventTarget.emit(cmd, msg.data);
            } else {
                error(`[WebSocket] 未知狀態: ${cmd}`);
            }
        };

        this.ws.onclose = (event: CloseEvent) => {
            WebsocketManager.instance.ws = null;
            WebsocketManager.instance = null;
            error(event.code, event.reason);
            close(event);
        };

        this.ws.onerror = (event: Event) => {
            error('[WebSocket] 連線錯誤', event);
        };

        return this;
    }

    /** 發送指令到伺服器 */
    public send<T extends ServerRoomType>(cmd: T, data: ServerRoomTypeMap[T]) {
        const msg: Client<T> = { cmd, data };
        this.ws.send(JSON.stringify(msg));
    }
}
