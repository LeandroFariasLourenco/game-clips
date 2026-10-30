import { Game } from '../types/game';
import { GAME_BRANDING_ASSETS, GameBrandingAssetType } from '../config/mediaConfig';
import { buildLocalMediaUrl, getGameFolderName } from './driveService';

export type GameAssetType = GameBrandingAssetType;

class RemoteAssetService {
  public getGameAsset(game: Game, assetType: GameAssetType): string {
    return buildLocalMediaUrl(getGameFolderName(game), GAME_BRANDING_ASSETS[assetType]);
  }

  public getGameCover(game: Game): string {
    if (game.cover) return game.cover;
    if (game.customCoverUrl) return game.customCoverUrl;
    return this.getGameAsset(game, 'cover');
  }

  public getGameBanner(game: Game): string {
    if (game.banner) return game.banner;
    if (game.customBannerUrl) return game.customBannerUrl;
    return this.getGameAsset(game, 'banner');
  }

  public getGameIcon(game: Game): string {
    if (game.icon) return game.icon;
    return this.getGameAsset(game, 'icon');
  }
}

export const localAssetService = new RemoteAssetService();
export const driveAssetService = localAssetService;
