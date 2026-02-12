import { _decorator, Component, Node, instantiate, Prefab, EventTarget } from 'cc';
const { ccclass, property } = _decorator;

export namespace BaseModel {
    export function getThousandth(num: number): string {
        const number = getFloor(num);
        return String(number).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
    /**
     * 無條件捨去
     * @param num 數字
     * @param index 小數位
     * @returns 
     */
    export function getFloor(num: number, decimalPlaces: number = 0): number {
        const factor = Math.pow(10, decimalPlaces);
        const number = Math.floor(num * factor) / factor;
        return number;
    }
    /**
     * 四捨五入並補足小數點
     * @param num 數字
     * @param index 小數位
     * @returns 
     */
    export function getRoundToStr(num: number, decimalPlaces: number = 0): string {
        const numStr = num.toFixed(decimalPlaces);
        return numStr;
        // return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
    export function getFormatNum(num: number): string {
        const absNum = Math.abs(num);
        const sign = num < 0 ? '-' : '';

        if (absNum >= 100000) {
            // 十萬
            const num = getFloor(absNum);
            return sign + getThousandth(num);
        } else if (absNum < 10) {
            return sign + getFloor(absNum, 2);
        } else {
            // 原數字（加千分位）
            const num = getFloor(absNum);
            return sign + getThousandth(num);
        }
    }
    export class Singleton<T> extends Component {
        private static _instances: Map<string, any> = new Map();

        protected onLoad(): void {
            const className = this.constructor.name;
            if (Singleton._instances.has(className)) {
                this.destroy();
            } else {
                Singleton._instances.set(className, this);
            }
        }

        public static getInstance<T extends Singleton<T>>(this: new () => T): T {
            const className = this.name;
            return Singleton._instances.get(className) as T;
        }

        public static destroyInstance<T extends Singleton<T>>(this: new () => T): void {
            const className = this.name;
            const instance = Singleton._instances.get(className);
            if (instance !== undefined) {
                Singleton._instances.delete(className);
                instance.destroy();
            }
        }
    }
    /**
     * 倒數計時
     * @param seconds 倒數秒數
     * @param onUpdate 每秒回呼，參數為剩餘秒數
     * @param onComplete 倒數結束回呼
     * @returns 取消倒數的函式
     */
    export function countdown(
        seconds: number,
        onUpdate?: (remaining: number) => void,
        onComplete?: () => void
    ): () => void {
        let remaining = Math.floor(seconds);
        onUpdate?.(remaining);

        const intervalId = setInterval(() => {
            remaining--;
            if (remaining <= 0) {
                clearInterval(intervalId);
                onUpdate?.(0);
                onComplete?.();
            } else {
                onUpdate?.(remaining);
            }
        }, 1000);

        return () => clearInterval(intervalId);
    }

    @ccclass('LayoutBase')
    export class LayoutBase<T extends Component> {
        @property({ type: Prefab })
        private obj: Prefab = null;

        @property({ type: Node })
        private layout: Node = null;

        public objs: T[] = [];

        public init(componentType: new () => T, count: number) {
            for (let i = 0; i < count; i++) {
                const node = instantiate(this.obj);
                const comp = node.getComponent(componentType as any) as T;
                this.objs.push(comp);
                this.layout.addChild(node);
            }
        }
    }
    export class GameEvent<Model extends string, Map extends Record<Model, any>> {
        protected eventTarget = new EventTarget();
        /** 監聽伺服器指令事件 */
        public on<T extends Model>(cmd: T, callback: (data: Map[T]) => void, target?: any) {
            this.eventTarget.on(cmd, callback, target);
        }

        /** 取消監聯伺服器指令事件 */
        public off<T extends Model>(cmd: T) {
            this.eventTarget.off(cmd);
        }

        /** 監聽伺服器指令事件 */
        public once<T extends Model>(cmd: T, callback: (data: Map[T]) => void, target?: any) {
            this.eventTarget.once(cmd, callback, target);
        }
    }
}

