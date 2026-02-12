import { _decorator, Component, log, Node } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('NewComponent')
export class NewComponent extends Component {
    ws: WebSocket = null;
    start() {
        this.ws = new WebSocket("ws://localhost:20001/connect?token=phoenix-test-e15bcb2770924204b8fc643b99af560d");

        this.ws.onopen = () => {
            console.log("WebSocket 連線已開啟");
            const currency = "TWD";
            const gameCode = "phoenix";
            this.sendOp('lobby.list', { currency, gameCode });
        };

        this.ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            console.log("收到訊息:", msg);
            const type = msg?.type;
            switch (type) {
                case "lobby.list":
                    const lobbyId = msg?.data?.lobbies[0].lobbyId;
                    const limit = 50;
                    const status = "open";
                    this.sendOp("room.list", { limit, lobbyId, status });
                    break;
                case "room.list":
                    const roomId = msg?.data?.rooms[0].roomId;
                    this.sendOp("room.list", { roomId });
                    break;
                // case "room.list":
                //     this.sendOp("room.join", data);
                //     break;
                // // case "room.create":
                // //     this.sendOp("room.join", data);
                // //     break;
                // case "room.join":
                //     this.sendOp("room.join", data);
                //     break;
                // case "room.joined":
                //     this.sendOp("game.init", data);
                //     break;
                // case "game.init":
                //     this.sendOp("game.balance", data);
                //     break;
                // case "game.balance":
                //     // this.sendOp("game.action", data);
                //     break;
                // case "crash.state":
                //     const currentMultiplier = msg?.data?.currentMultiplier;
                //     console.log(currentMultiplier);
                //     break;
            }
        };

        this.ws.onerror = (event) => {
            console.error("WebSocket 發生錯誤:", event);
        };

        this.ws.onclose = (event) => {
            console.log("WebSocket 連線已關閉, code:", event.code, "reason:", event.reason);
        };
    }

    update(deltaTime: number) {

    }

    sendOp(op, data) {
        const payload = { op, data };
        this.ws.send(JSON.stringify(payload));
    }
}


