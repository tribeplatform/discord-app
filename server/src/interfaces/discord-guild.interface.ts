export interface DiscordGuild {
    id: string,
    name: string,
    icon: string,
    owner: boolean,
    permissions: number,
    features: string[],
    permissions_new: string
}