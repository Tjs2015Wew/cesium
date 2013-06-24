/*global define*/
define([
        '../Core/DeveloperError',
        '../Core/defaultValue',
        '../Core/Color',
        '../Core/destroyObject',
        '../Core/Math',
        '../Core/Ellipsoid',
        '../Core/GeometryInstance',
        '../Core/PolygonGeometry',
        '../Core/PolygonPipeline',
        '../Core/Queue',
        './EllipsoidSurfaceAppearance',
        './Primitive',
        './Material'
    ], function(
        DeveloperError,
        defaultValue,
        Color,
        destroyObject,
        CesiumMath,
        Ellipsoid,
        GeometryInstance,
        PolygonGeometry,
        PolygonPipeline,
        Queue,
        EllipsoidSurfaceAppearance,
        Primitive,
        Material) {
    "use strict";

    /**
     * DOC_TBA
     *
     * @alias Polygon
     * @constructor
     *
     * @example
     * var polygon = new Polygon();
     * polygon.material.uniforms.color = {
     *   red   : 1.0,
     *   green : 0.0,
     *   blue  : 0.0,
     *   alpha : 1.0
     * };
     * polygon.setPositions([
     *   ellipsoid.cartographicToCartesian(new Cartographic(...)),
     *   ellipsoid.cartographicToCartesian(new Cartographic(...)),
     *   ellipsoid.cartographicToCartesian(new Cartographic(...))
     * ]);
     *
     * @demo <a href="http://cesium.agi.com/Cesium/Apps/Sandcastle/index.html?src=Polygons.html">Cesium Sandcastle Polygons Demo</a>
     */
    var Polygon = function(options) {
        options = defaultValue(options, defaultValue.EMPTY_OBJECT);

        /**
         * DOC_TBA
         */
        this.ellipsoid = defaultValue(options.ellipsoid, Ellipsoid.WGS84);
        this._ellipsoid = undefined;

        /**
         * DOC_TBA
         */
        this.granularity = defaultValue(options.granularity, CesiumMath.toRadians(1.0));
        this._granularity = undefined;

        /**
         * DOC_TBA
         */
        this.height = defaultValue(options.height, 0.0);
        this._height = undefined;

        /**
         * DOC_TBA
         */
        this.textureRotationAngle = options.textureRotationAngle;
        this._textureRotationAngle = undefined;

        /**
         * Determines if this primitive will be shown.
         *
         * @type Boolean
         */
        this.show = defaultValue(options.show, true);

        var material = Material.fromType(undefined, Material.ColorType);
        material.uniforms.color = new Color(1.0, 1.0, 0.0, 0.5);

        /**
         * The surface appearance of the primitive.  This can be one of several built-in {@link Material} objects or a custom material, scripted with
         * <a href='https://github.com/AnalyticalGraphicsInc/cesium/wiki/Fabric'>Fabric</a>.
         * <p>
         * The default material is <code>Material.ColorType</code>.
         * </p>
         *
         * @type Material
         *
         * @example
         * // 1. Change the color of the default material to yellow
         * polygon.material.uniforms.color = new Color(1.0, 1.0, 0.0, 1.0);
         *
         * // 2. Change material to horizontal stripes
         * polygon.material = Material.fromType(scene.getContext(), Material.StripeType);
         *
         * @see <a href='https://github.com/AnalyticalGraphicsInc/cesium/wiki/Fabric'>Fabric</a>
         */
        this.material = defaultValue(options.material, material);

        this._positions = options.positions;
        this._polygonHierarchy = options.polygonHierarchy;
        this._createPrimitive = false;

        this._primitive = undefined;
    };

    /**
     * DOC_TBA
     *
     * @memberof Polygon
     *
     * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
     *
     * @see Polygon#setPositions
     */
    Polygon.prototype.getPositions = function() {
        return this._positions;
    };

    /**
     * DOC_TBA
     *
     * @memberof Polygon
     *
     * @exception {DeveloperError} At least three positions are required.
     * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
     *
     * @see Polygon#getPositions
     *
     * @param {Array} positions The cartesian positions of the polygon.
     *
     * @example
     * polygon.setPositions([
     *   ellipsoid.cartographicToCartesian(new Cartographic(...)),
     *   ellipsoid.cartographicToCartesian(new Cartographic(...)),
     *   ellipsoid.cartographicToCartesian(new Cartographic(...))
     * ]);
     */
    Polygon.prototype.setPositions = function(positions) {
        // positions can be undefined
        if (typeof positions !== 'undefined' && (positions.length < 3)) {
            throw new DeveloperError('At least three positions are required.');
        }
        this._positions = positions;
        this._polygonHierarchy = undefined;
        this._createPrimitive = true;
    };

    /**
     * Create a set of polygons with holes from a nested hierarchy.
     *
     * @memberof Polygon
     *
     * @param {Object} hierarchy An object defining the vertex positions of each nested polygon.
     * For example, the following polygon has two holes, and one hole has a hole. <code>holes</code> is optional.
     * Leaf nodes only have <code>positions</code>.
     * <pre>
     * <code>
     * {
     *  positions : [ ... ],    // The polygon's outer boundary
     *  holes : [               // The polygon's inner holes
     *    {
     *      positions : [ ... ]
     *    },
     *    {
     *      positions : [ ... ],
     *      holes : [           // A polygon within a hole
     *       {
     *         positions : [ ... ]
     *       }
     *      ]
     *    }
     *  ]
     * }
     * </code>
     * </pre>
     *
     * @exception {DeveloperError} At least three positions are required.
     *
     * @example
     * // A triangle within a triangle
     * var hierarchy = {
     *     positions : [new Cartesian3(-634066.5629045101,-4608738.034138676,4348640.761750969),
     *                  new Cartesian3(-1321523.0597310204,-5108871.981065817,3570395.2500986718),
     *                  new Cartesian3(46839.74837473363,-5303481.972379478,3530933.5841716)],
     *     holes : [{
     *         positions :[new Cartesian3(-646079.44483647,-4811233.11175887,4123187.2266941597),
     *                     new Cartesian3(-1024015.4454943262,-5072141.413164587,3716492.6173834214),
     *                     new Cartesian3(-234678.22583880965,-5189078.820849883,3688809.059214336)]
     *      }]
     *  };
     */
    Polygon.prototype.configureFromPolygonHierarchy  = function(hierarchy) {
        // Algorithm adapted from http://www.geometrictools.com/Documentation/TriangulationByEarClipping.pdf
        var polygons = [];
        var queue = new Queue();
        queue.enqueue(hierarchy);

        while (queue.length !== 0) {
            var outerNode = queue.dequeue();
            var outerRing = outerNode.positions;

            if (outerRing.length < 3) {
                throw new DeveloperError('At least three positions are required.');
            }

            var numChildren = outerNode.holes ? outerNode.holes.length : 0;
            if (numChildren === 0) {
                // The outer polygon is a simple polygon with no nested inner polygon.
                polygons.push(outerNode.positions);
            } else {
                // The outer polygon contains inner polygons
                var holes = [];
                for ( var i = 0; i < numChildren; i++) {
                    var hole = outerNode.holes[i];
                    holes.push(hole.positions);

                    var numGrandchildren = 0;
                    if (hole.holes) {
                        numGrandchildren = hole.holes.length;
                    }

                    for ( var j = 0; j < numGrandchildren; j++) {
                        queue.enqueue(hole.holes[j]);
                    }
                }
                var combinedPolygon = PolygonPipeline.eliminateHoles(outerRing, holes);
                polygons.push(combinedPolygon);
            }
        }

        this._positions = undefined;
        this._polygonHierarchy = polygons;
        this._createPrimitive = true;
    };

    function defined(value) {
        return typeof value !== 'undefined';
    }

    /**
     * @private
     */
    Polygon.prototype.update = function(context, frameState, commandList) {
        if (typeof this.ellipsoid === 'undefined') {
            throw new DeveloperError('this.ellipsoid must be defined.');
        }

        if (typeof this.material === 'undefined') {
            throw new DeveloperError('this.material must be defined.');
        }

        if (this.granularity < 0.0) {
            throw new DeveloperError('this.granularity and scene2D/scene3D overrides must be greater than zero.');
        }

        if (!this.show) {
            return;
        }

        if (!this._createPrimitive && !defined(this._primitive)) {
            // No positions/hierarchy to draw
            return;
        }

        if (this._createPrimitive ||
            (this._ellipsoid !== this.ellipsoid) ||
            (this._granularity !== this.granularity) ||
            (this._height !== this.height) ||
            (this._textureRotationAngle !== this.textureRotationAngle)) {

            this._createPrimitive = false;
            this._ellipsoid = this.ellipsoid;
            this._granularity = this.granularity;
            this._height = this.height;
            this._textureRotationAngle = this.textureRotationAngle;

            this._primitive = this._primitive && this._primitive.destroy();

            if (!defined(this._positions) && !defined(this._polygonHierarchy)) {
                return;
            }

            var instance = new GeometryInstance({
                geometry : new PolygonGeometry({
                    positions : this._positions,
                    polygonHierarchy : this._polygonHierarchy,
                    height : this.height,
                    vertexFormat : EllipsoidSurfaceAppearance.VERTEX_FORMAT,
                    stRotation : this.textureRotationAngle,
                    ellipsoid : this.ellipsoid,
                    granularity : this.granularity
                }),
                pickData : this
            });

            this._primitive = new Primitive({
                geometryInstances : instance,
                appearance : new EllipsoidSurfaceAppearance({
                    aboveGround : (this.height > 0.0)
                })
            });
        }

        this._primitive.appearance.material = this.material;
        this._primitive.update(context, frameState, commandList);
    };

    /**
     * Returns true if this object was destroyed; otherwise, false.
     * <br /><br />
     * If this object was destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.
     *
     * @memberof Extent
     *
     * @return {Boolean} <code>true</code> if this object was destroyed; otherwise, <code>false</code>.
     *
     * @see Extent#destroy
     */
    Polygon.prototype.isDestroyed = function() {
        return false;
    };

    /**
     * Destroys the WebGL resources held by this object.  Destroying an object allows for deterministic
     * release of WebGL resources, instead of relying on the garbage collector to destroy this object.
     * <br /><br />
     * Once an object is destroyed, it should not be used; calling any function other than
     * <code>isDestroyed</code> will result in a {@link DeveloperError} exception.  Therefore,
     * assign the return value (<code>undefined</code>) to the object as done in the example.
     *
     * @memberof Polygon
     *
     * @return {undefined}
     *
     * @exception {DeveloperError} This object was destroyed, i.e., destroy() was called.
     *
     * @see Extent#isDestroyed
     *
     * @example
     * extent = extent && extent.destroy();
     */
    Polygon.prototype.destroy = function() {
        this._primitive = this._primitive && this._primitive.destroy();
        return destroyObject(this);
    };

    return Polygon;
});
