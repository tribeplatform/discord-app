import { IncomingProfile } from '@/interfaces/incoming-profile.interface';
import IncomingProfileModel from '@/models/profile.model';
import { logger } from '@/utils/logger';

class DiscordRepository{

    public async insertProfileData(data: IncomingProfile){
        try{

            return await IncomingProfileModel.create(data)

        }catch(e){
            logger.error(e, { context: 'DiscordRepository'});
        }

    }
}

export default new DiscordRepository()