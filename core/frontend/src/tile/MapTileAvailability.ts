/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/

import { MapTilingScheme, MapTileRectangle } from "./MapTilingScheme";
import { Cartographic } from "@bentley/imodeljs-common";
import { SortedArray } from "@bentley/bentleyjs-core";

// portions adapted from Cesium.js Copyright 2011 - 2017 Cesium Contributors
/** @packageDocumentation
 * @module Tile
 */

/** @internal */
class RectangleWithLevel extends MapTileRectangle {
  constructor(public level: number, west: number, south: number, east: number, north: number) {
    super(west, south, east, north);
  }
}

/** @internal */
class QuadTreeNode {
  private _sw?: QuadTreeNode;
  private _se?: QuadTreeNode;
  private _nw?: QuadTreeNode;
  private _ne?: QuadTreeNode;
  public extent: MapTileRectangle;
  public rectangles = new SortedArray<RectangleWithLevel>((lhs: RectangleWithLevel, rhs: RectangleWithLevel) => lhs.level - rhs.level, true);
  constructor(public tilingScheme: MapTilingScheme, public parent: QuadTreeNode | undefined, public level: number, public x: number, public y: number) {
    this.extent = tilingScheme.tileXYToRectangle(x, y, level + 1);
  }
  public get nw(): QuadTreeNode {
    if (!this._nw)
      this._nw = new QuadTreeNode(this.tilingScheme, this, this.level + 1, this.x * 2, this.y * 2);

    return this._nw;
  }
  public get ne(): QuadTreeNode {
    if (!this._ne)
      this._ne = new QuadTreeNode(this.tilingScheme, this, this.level + 1, this.x * 2 + 1, this.y * 2);

    return this._ne;
  }
  public get sw(): QuadTreeNode {
    if (!this._sw)
      this._sw = new QuadTreeNode(this.tilingScheme, this, this.level + 1, this.x * 2, this.y * 2 + 1);

    return this._sw;
  }
  public get se(): QuadTreeNode {
    if (!this._se)
      this._se = new QuadTreeNode(this.tilingScheme, this, this.level + 1, this.x * 2 + 1, this.y * 2 + 1);

    return this._se;
  }
}

/** @internal */
function putRectangleInQuadtree(maxDepth: number, node: QuadTreeNode, rectangle: RectangleWithLevel) {
  while (node.level < maxDepth) {
    if (node.nw.extent.containsRange(rectangle)) {
      node = node.nw;
    } else if (node.ne.extent.containsRange(rectangle)) {
      node = node.ne;
    } else if (node.sw.extent.containsRange(rectangle)) {
      node = node.sw;
    } else if (node.se.extent.containsRange(rectangle)) {
      node = node.se;
    } else {
      break;
    }
  }

  node.rectangles.insert(rectangle);
}

/** @internal */
export class TileAvailability {
  private _rootNodes = new Array<QuadTreeNode>();
  constructor(private _tilingScheme: MapTilingScheme, private _maximumLevel: number) { }

  public static rectangleScratch = MapTileRectangle.create();

  public findNode(level: number, x: number, y: number, nodes: QuadTreeNode[]) {
    for (const node of nodes) {
      if (node.x === x && node.y === y && node.level === level) {
        return true;
      }
    }
    return false;
  }

  /**
   * Marks a rectangular range of tiles in a particular level as being available.  For best performance,
   * add your ranges in order of increasing level.
   *
   * @param {Number} level The level.
   * @param {Number} startX The X coordinate of the first available tiles at the level.
   * @param {Number} startY The Y coordinate of the first available tiles at the level.
   * @param {Number} endX The X coordinate of the last available tiles at the level.
   * @param {Number} endY The Y coordinate of the last available tiles at the level.
   */
  public addAvailableTileRange(level: number, startX: number, startY: number, endX: number, endY: number) {
    const tilingScheme = this._tilingScheme;
    const rootNodes = this._rootNodes;
    if (level === 0) {
      for (let y = startY; y <= endY; ++y) {
        for (let x = startX; x <= endX; ++x) {
          if (!this.findNode(level, x, y, rootNodes)) {
            rootNodes.push(new QuadTreeNode(tilingScheme, undefined, 0, x, y));
          }
        }
      }
    }

    tilingScheme.tileXYToRectangle(startX, startY, level + 1, TileAvailability.rectangleScratch);
    const west = TileAvailability.rectangleScratch.west;
    const south = TileAvailability.rectangleScratch.south;

    tilingScheme.tileXYToRectangle(endX, endY, level + 1, TileAvailability.rectangleScratch);
    const east = TileAvailability.rectangleScratch.east;
    const north = TileAvailability.rectangleScratch.north;

    const rectangleWithLevel = new RectangleWithLevel(level, west, south, east, north);

    for (const rootNode of rootNodes) {
      if (rootNode.extent.intersectsRange(rectangleWithLevel)) {
        putRectangleInQuadtree(this._maximumLevel, rootNode, rectangleWithLevel);
      }
    }
  }

  public computeMaximumLevelAtPosition(position: Cartographic): number {
    // Find the root node that contains this position.
    let node;
    for (const rootNode of this._rootNodes) {
      if (rootNode.extent.containsCartographic(position)) {
        node = rootNode;
        break;
      }
    }

    if (undefined === node) {
      return -1;
    }

    return this.findMaxLevelFromNode(undefined, node, position);
  }

  private _cartographicScratch = new Cartographic();

  /**
   * Determines if a particular tile is available.
   * @param {Number} level The tile level to check.
   * @param {Number} x The X coordinate of the tile to check.
   * @param {Number} y The Y coordinate of the tile to check.
   * @return {Boolean} True if the tile is available; otherwise, false.
   */
  public isTileAvailable(level: number, x: number, y: number): boolean {
    // Get the center of the tile and find the maximum level at that position.
    // Because availability is by tile, if the level is available at that point, it
    // is sure to be available for the whole tile.  We assume that if a tile at level n exists,
    // then all its parent tiles back to level 0 exist too.  This isn't really enforced
    // anywhere, but Cesium would never load a tile for which this is not true.
    const rectangle = this._tilingScheme.tileXYToRectangle(x, y, level + 1, TileAvailability.rectangleScratch);
    rectangle.getCenter(this._cartographicScratch);
    return this.computeMaximumLevelAtPosition(this._cartographicScratch) >= level;
  }

  private findMaxLevelFromNode(stopNode: QuadTreeNode | undefined, node: QuadTreeNode | undefined, position: Cartographic) {
    let maxLevel = 0;

    // Find the deepest quadtree node containing this point.
    let found = false;
    while (!found) {
      const nw = node!.nw && node!.nw.extent.containsCartographic(position);
      const ne = node!.ne && node!.ne.extent.containsCartographic(position);
      const sw = node!.sw && node!.sw.extent.containsCartographic(position);
      const se = node!.se && node!.se.extent.containsCartographic(position);

      // The common scenario is that the point is in only one quadrant and we can simply
      // iterate down the tree.  But if the point is on a boundary between tiles, it is
      // in multiple tiles and we need to check all of them, so use recursion.
      if ((nw ? 1 : 0) + (ne ? 1 : 0) + (sw ? 1 : 0) + (se ? 1 : 0) > 1) {
        if (nw) {
          maxLevel = Math.max(maxLevel, this.findMaxLevelFromNode(node, node!.nw, position));
        }
        if (ne) {
          maxLevel = Math.max(maxLevel, this.findMaxLevelFromNode(node, node!.ne, position));
        }
        if (sw) {
          maxLevel = Math.max(maxLevel, this.findMaxLevelFromNode(node, node!.sw, position));
        }
        if (se) {
          maxLevel = Math.max(maxLevel, this.findMaxLevelFromNode(node, node!.se, position));
        }
        break;
      } else if (nw) {
        node = node!.nw;
      } else if (ne) {
        node = node!.ne;
      } else if (sw) {
        node = node!.sw;
      } else if (se) {
        node = node!.se;
      } else {
        found = true;
      }
    }

    // Work up the tree until we find a rectangle that contains this point.
    while (node !== stopNode) {
      const rectangles = node!.rectangles;

      // Rectangles are sorted by level, lowest first.
      for (let i = rectangles.length - 1; i >= 0 && rectangles.get(i)!.level > maxLevel; --i) {
        const rectangle = rectangles.get(i)!;
        if (rectangle.containsCartographic(position))
          maxLevel = rectangle.level;
      }
      node = node!.parent!;
    }
    return maxLevel;
  }
}