import axios, { AxiosInstance } from 'axios'
import * as WebSocket from 'ws'
import { EventEmitter } from 'events'
import { ElementApiOptions, ElementResponse, Options } from './models'
import { CreateTagOpts, Tag } from './models/tags'
import { MergeOptions, Reading, UpdatedReadings } from './models/readings'
import { ElementActionRequest, ElementActionResponse } from './models/actions'
import { Device, CreateDeviceInterface, DeviceInterface } from './models/devices'
import { Packet } from './models/packets'

export class ElementKit {
    private client: AxiosInstance
    private rateLimitRemaining: number
    private rateLimitReset: number
    private logger: (msg: string) => void

    constructor(options: ElementApiOptions, httpClient?: AxiosInstance) {
        if (options.apiKey === undefined || options.apiKey === '') {
            throw new Error("Missing api key")
        }
        if (!httpClient && options.serviceUrl !== undefined &&
            (!options.serviceUrl.startsWith('https') && !options.serviceUrl.startsWith('http'))) {
            throw new Error("serviceUrl must start with https")
        }

        this.logger = options.logger ? options.logger : console.log
        this.rateLimitRemaining = options.rateLimit?.remaining || 50
        this.rateLimitReset = options.rateLimit?.reset || 5000

        if (!httpClient) {
            this.client = axios.create({
                baseURL: `${options.serviceUrl || "https://element-iot.com"}/`
            })
        } else {
            this.client = httpClient
        }

        this.client.interceptors.request.use((config) => {
            config.params = config.params || {};
            config.params['auth'] = options.apiKey
            return config;
        });
        const that = this
        this.client.interceptors.response.use(async (response) => {
            const rateLimitRemaining = response.headers['x-ratelimit-remaining']
            const rateLimitReset = response.headers['x-ratelimit-reset']
            this.logger(`Rate limit remaining ${rateLimitRemaining}`)
            this.logger(`Rate limit reset ${rateLimitReset}`)
            that.rateLimitRemaining = rateLimitRemaining || 5
            that.rateLimitReset = rateLimitReset || 5000
            return response;
        });
        this.client.interceptors.request.use(async (config) => {
            if (that.rateLimitRemaining <= 5) {
                this.logger(`Rate limit reset in ${that.rateLimitReset}`)
                await new Promise(resolve => setTimeout(resolve, that.rateLimitReset * 2))
            }
            return config;
        });
    }

    async getDevice(elementDeviceId: string): Promise<ElementResponse<Device>> {
        return (await this.client.get(`api/v1/devices/${elementDeviceId}`)).data
    }

    async findDeviceByDevEUI(deviceEUI: string): Promise<ElementResponse<Device[]>> {
        return (await this.client.get(`api/v1/devices/by-eui/${deviceEUI}`)).data
    }

    async getTag(tagId: string): Promise<Tag> {
        return (await this.client.get<ElementResponse<Tag>>(`api/v1/tags/${tagId}`)).data.body
    }

    async getTags(options?: Options): Promise<Tag[]> {
        if (options?.limit && options?.limit <= 100) {
            return (await this.client.get<ElementResponse<Tag[]>>(`api/v1/tags`, { params: this.createParams(options) })).data.body
        } else {
            return this.paginate<Tag[]>(`tags`, options)
        }
    }

    async getDevicesByTagId(tagId: string, options?: Options): Promise<Device[]> {
        if (options?.limit && options?.limit <= 100) {
            return (await this.client.get<ElementResponse<Device[]>>(`api/v1/tags/${tagId}/devices`, { params: this.createParams(options) })).data.body
        } else {
            return this.paginate<Device[]>(`tags/${tagId}/devices`, options)
        }
    }

    async getDevices(options?: Options): Promise<Device[]> {
        if (options?.limit && options?.limit <= 100) {
            return (await this.client.get<ElementResponse<Device[]>>(`api/v1/devices`, { params: this.createParams(options) })).data.body
        } else {
            return this.paginate<Device[]>(`devices`, options)
        }
    }

    async getReadingsByTagId(tagId: string, options?: Options): Promise<Reading[]> {
        if (options?.limit && options?.limit <= 100) {
            return (await this.client.get<ElementResponse<Reading[]>>(`api/v1/tags/${tagId}/readings`, { params: this.createParams(options) })).data.body
        } else {
            return this.paginate<Reading[]>(`tags/${tagId}/readings`, options)
        }
    }

    async getPacketsByTagId(tagId: string, options?: Options): Promise<Packet[]> {
        if (options?.limit && options?.limit <= 100) {
            return (await this.client.get<ElementResponse<Packet[]>>(`api/v1/tags/${tagId}/packets`, { params: this.createParams(options) })).data.body
        } else {
            return this.paginate<Packet[]>(`tags/${tagId}/packets`, options)
        }
    }

    async getPackets(deviceId: string, options?: Options): Promise<Packet[]> {
        if (options?.limit && options?.limit <= 100) {
            return (await this.client.get(`api/v1/devices/${deviceId}/packets?`, { params: this.createParams(options) })).data.body
        } else {
            return this.paginate<Packet[]>(`devices/${deviceId}/packets`, options)
        }
    }

    async getPacketsChunked(deviceId: string, onChunk: (chunk: Packet[]) => Promise<void>, options?: Options): Promise<void> {
        return this.paginateChunked<Packet[]>(`devices/${deviceId}/packets`, onChunk, options)
    }

    async getReadingsChunked(deviceId: string, onChunk: (chunk: Reading[]) => Promise<void>, options?: Options): Promise<void> {
        return this.paginateChunked<Reading[]>(`devices/${deviceId}/readings`, onChunk, options)
    }

    async getReadings(deviceId: string, options?: Options): Promise<Reading[]> {
        if (options?.limit && options?.limit <= 100) {
            return (await this.client.get(`api/v1/devices/${deviceId}/readings`, { params: this.createParams(options) })).data.body
        } else {
            return this.paginate<Reading[]>(`devices/${deviceId}/readings`, options)
        }
    }

    private createParams(options: Options): any {
        const params = {}
        if (options.limit) {
            params['limit'] = options.limit
        }

        if (options.retrieveAfterId) {
            params['retrieve_after'] = options.retrieveAfterId
        }

        if (options.sort) {
            params['sort'] = options.sort
        }

        if (options.sortDirection) {
            params['sort_direction'] = options.sortDirection
        }

        if (options.filter) {
            params['filter'] = options.filter
        }
        if (options.withProfile) {
            params['with_profile'] = options.withProfile
        }

        return params
    }

    private async paginate<T>(resource: string, options?: Options) {
        let retrieveAfterId = options?.retrieveAfterId || undefined
        let values = []
        do {
            const params = this.createParams({
                limit: 100,
                ...options,
                retrieveAfterId
            })
            const response = await this.client.get<ElementResponse<T>>(`api/v1/${resource}`, { params })
            values = values.concat(response.data.body)
            retrieveAfterId = response.data.retrieve_after_id
        } while (retrieveAfterId !== undefined)
        return values

    }
    private async paginateChunked<T>(resource: string, onChunk: (chunk: T) => Promise<void>, options?: Options) {
        let retrieveAfterId = options?.retrieveAfterId || undefined
        do {
            const params = this.createParams({
                limit: 100,
                ...options,
                retrieveAfterId
            })
            const response = await this.client.get<ElementResponse<T>>(`api/v1/${resource}`, { params })
            if ((response.data.body as any).length > 0) {
                await onChunk(response.data.body)
            }

            retrieveAfterId = response.data.retrieve_after_id
        } while (retrieveAfterId !== undefined)
    }

    async createDevice(name: string, tagId: string): Promise<ElementResponse<Device>> {
        return (await this.client.post(`api/v1/devices`, {
            device: {
                name: name,
                tags: [{
                    id: tagId
                }]
            }
        })).data
    }

    async deleteDevice(deviceId: string): Promise<ElementResponse<unknown>> {
        return await this.client.delete(`api/v1/devices/${deviceId}`)
    }

    async addInterfaceToDevice(deviceId: string, deviceInterface: CreateDeviceInterface): Promise<DeviceInterface> {
        return (await this.client.post(`api/v1/devices/${deviceId}/interfaces`, {
            interface: deviceInterface
        })).data
    }

    async deleteInterface(deviceId: string, interfaceId: string): Promise<ElementResponse<unknown>> {
        return (await this.client.delete(`api/v1/devices/${deviceId}/interfaces/${interfaceId}`)).data
    }

    async listInterfaces(deviceId: string): Promise<ElementResponse<DeviceInterface[]>> {
        return (await this.client.get(`api/v1/devices/${deviceId}/interfaces`)).data
    }

    async createActionOnInterface(deviceId: string, interfaceId: string, request: ElementActionRequest): Promise<ElementActionResponse> {
        return (await this.client.post(`api/v1/devices/${deviceId}/interfaces/${interfaceId}/actions/send_down_frame`, request)).data
    }

    async createAction(deviceId: string, request: ElementActionRequest): Promise<ElementActionResponse> {
        return (await this.client.post(`api/v1/devices/${deviceId}/actions/send_down_frame`, request)).data
    }

    async getAction(deviceId: string, actionId: string): Promise<ElementActionResponse> {
        return (await this.client.get(`api/v1/devices/${deviceId}/actions/${actionId}`)).data
    }

    async createTag(name: string, opts: CreateTagOpts | null = null): Promise<ElementResponse<Tag>> {
        const request = {
            tag: {
                name: name,
                ...opts
            }
        }
        return (await this.client.post(`api/v1/tags`, request)).data
    }

    async createTagPath(name: string): Promise<ElementResponse<Tag>> {
        const request = {
            name: name
        }
        return (await this.client.post(`api/v1/tags/mkdir`, request)).data
    }

    async deleteTag(tagId: string): Promise<ElementResponse<unknown>> {
        return (await this.client.delete(`api/v1/tags${tagId}`))
    }

    /* Not in production yet */
    async updateReadings(data: MergeOptions): Promise<UpdatedReadings> {
        return (await this.client.patch<ElementResponse<UpdatedReadings>>(`api/v1/readings`, data)).data.body
    }    
    async updateReadingsByDevice(data: MergeOptions, deviceId: string): Promise<UpdatedReadings> {
        return (await this.client.patch<ElementResponse<UpdatedReadings>>(`api/v1/devices/${deviceId}/readings`, data)).data.body
    }
}

export class ElementKitWS extends EventEmitter {

    private apiKey: string
    private serviceUrl: string
    pingTimeout: NodeJS.Timeout
    ws: WebSocket
    type: string
    private logger: (msg) => void

    constructor(options: ElementApiOptions, type: 'readings' | 'packets', tagId?: string) {
        super()
        if (options.apiKey === undefined || options.apiKey === '') {
            throw new Error("Missing api key")
        }
        if (options.serviceUrl !== undefined &&
            (!options.serviceUrl.startsWith('wss') || !options.serviceUrl.startsWith('ws'))) {
            throw new Error("serviceUrl must start with ws:// or wss://")
        }
        this.logger = options.logger ? options.logger : console.log
        this.apiKey = options.apiKey
        this.serviceUrl = options.serviceUrl || "wss://element-iot.com"
        this.type = type


        if (tagId) {
            this.ws = new WebSocket(`${this.serviceUrl}/api/v1/tags/${tagId}/${type}/socket?auth=${this.apiKey}`);
        } else {
            this.ws = new WebSocket(`${this.serviceUrl}/api/v1/${type}/socket?auth=${this.apiKey}`)
        }

        this.ws.on('open', this.open.bind(this));
        this.ws.on('ping', this.heartbeat.bind(this));
        this.ws.on('close', this.close.bind(this));
        this.ws.on('error', function onError(error) {
            this.emit('error', error)
        }.bind(this))
        this.ws.on('message', this.onMessage.bind(this))
    }

    private onMessage(message: WebSocket.Data) {
        const messageString = message.toString('utf-8')
        if (message !== 'pong') {
            try {
                const data = JSON.parse(messageString)[0]
                if (data.event === 'reading_added') {
                    this.emit('readings', { ...data.body })
                } else if (data.event === 'packet_added') {
                    this.emit('packets', { ...data.body })
                }

            } catch (error) {
                console.error(error);
            }
        }
    }

    private open() {
        this.logger("ELEMENT Kit Connection open")
        this.emit("open")
        this.heartbeat()
    }
    private close() {
        this.logger("ELEMENT Kit Connection closed")
        clearTimeout(this.pingTimeout)
        this.emit("close")
        
    }

    private heartbeat() {
        this.logger("ELEMENT Kit sending heartbeat")
        clearTimeout(this.pingTimeout)
        this.pingTimeout = setTimeout(function () {
            this.heartbeat()
        }.bind(this), 30000 + 1000)
        this.ws.ping()
    }

    disconnect() {
        this.ws.close()
    }
}
