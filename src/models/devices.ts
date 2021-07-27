import { Tag } from "./tags";

export interface Device {
    id: string;
    mandate_id: string;
    name: string;
    slug: string;
    parser_id: string | null;
    location?: Point;
    tags: Tag[];
    interfaces: DeviceInterface;
    fields: unknown;
}

export interface Point {
    type: 'Point';
    coordinates: number[];
}

export interface CreateDeviceInterface {
    name: string;
    driver_instance_id: string;
    opts: unknown;
    enabled: boolean;
}
export interface DeviceInterface {
    id: string;
    name: string;
    driver_instance_id: string;
    opts: unknown;
    enabled: boolean;
}
