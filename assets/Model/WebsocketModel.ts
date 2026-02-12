export interface ServerRoom {
    op: Room;
}

export enum Room {
    Create = "room.create"
}

export interface RoomMap {
    [Room.Create]: Create;
}

export interface Create {
    roomId: string;
    gameType: string;
    gameCode: string;
}

export interface ClientRoom<T extends Room> {
    data: RoomMap[T];
    status: Status;
    type: T;
}

export enum Status {
    ok = "ok",
    error = "error"
}