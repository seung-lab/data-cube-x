"use strict";

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var _loadingimg = new Image();
_loadingimg.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAATpJREFUeNrs18ENgCAQAEE09iJl0H8F2o0N+DTZh7NPcr/JEdjWWuOtc87X8/u6zH84vw+lAQAAQAAACMA/O7zH23kb4AoCIAAABACAin+A93g7bwNcQQAEAIAAAFDxD/Aeb+dtgCsIgAAAEAAAKv4B3uPtvA1wBQEQAAACAEDFP8B7vJ23Aa4gAAIAQAAAqPgHeI+38zbAFQRAAAAIAAAV/wDv8XbeBriCAAgAAAEAoOIf4D3eztsAVxAAAQAgAABU/AO8x9t5G+AKAiAAAAQAgIp/gPd4O28DXEEABACAAABQ8Q/wHm/nbYArCIAAABAAACr+Ad7j7bwNcAUBEAAAAgBAxT/Ae7ydtwGuIAACAEAAAKj4B3iPt/M2wBUEQAAACAAAFf8A7/F23ga4ggAIAAABAKCgR4ABAIa/f2QspBp6AAAAAElFTkSuQmCC";

/* Volume
 *
 * Represents a 3D bounding box in the data set's global coordinate space.
 * Contains two types of images: channel (raw EM images), 
 * and segmentation (AI determined supervoxels)
 *
 * Required:
 *   task_id: (int) The task id representing a task in Eyewire
 *   channel: A blankable Datacube representing the channel values. 
 *        Since they're grayscale, an efficient representation is 1 byte
 *   segmentation: A blankable Datacube representing segmentation values.
 * 		  Seg ids don't appear to rise above the high thousands, so 2 bytes is probably sufficent.
 *
 * Return: Volume object
 */

var Volume = function () {
	function Volume(args) {
		_classCallCheck(this, Volume);

		this.task_id = args.task_id;

		this.channel = args.channel; // a data cube
		this.segmentation = args.segmentation; // a segmentation cube

		this.segments = {};

		this.CHUNK_SIZE = 128; // Fixed in e2198
		this.BUNDLE_SIZE = args.bundle_size || 64; // 128 = ~260kB, but fastest overall

		this.requests = [];
	}

	/* load
  *
  * Download the channel and segmentation and materialize them into
  * their respective datacubes.
  *
  * Return: promise representing download completion state
  */

	_createClass(Volume, [{
		key: "load",
		value: function load() {
			var _this = this;

			if (!this.channel.clean) {
				this.channel.clear();
			}

			if (!this.segmentation.clean) {
				this.segmentation.clear();
			}

			this.requests = [];

			var deferred = $.Deferred();

			$.getJSON("http://eyewire.org/1.0/task/" + this.task_id + "/volumes").done(function (task) {
				var channel_promise = _this.loadVolume(task.channel_id, _this.channel);
				//let channel_promise = _this.loadMovieVolume('./channel/channel.webm', _this.channel);
				var seg_promise = _this.loadVolume(task.segmentation_id, _this.segmentation);

				$.when(channel_promise, seg_promise).done(function () {
					deferred.resolve();
				}).fail(function () {
					deferred.reject();
				}).always(function () {
					_this.requests = [];
				});
			}).fail(function () {
				deferred.reject();
			});

			return deferred;
		}

		/* loadingProgress
   *
   * How far along the download are we?
   *
   * Return: float [0, 1]
   */

	}, {
		key: "loadingProgress",
		value: function loadingProgress() {
			if (this.segmentation.loaded && this.channel.loaded) {
				return 1;
			} else if (this.segmentation.clean && this.channel.clean) {
				return 0;
			} else if (this.requests.length === 0) {
				return 0;
			}

			var specs = this.generateUrls();

			var resolved = this.requests.filter(function (req) {
				return req.state() !== 'pending';
			});
			return resolved.length / (2 * specs.length);
		}

		/* abort
   *
   * Terminate in progress downloads.
   *
   * Return: void
   */

	}, {
		key: "abort",
		value: function abort() {
			this.requests.forEach(function (jqxhr) {
				jqxhr.abort();
			});
		}

		// used for testing correctness of pixel values loaded into data cube

	}, {
		key: "fakeLoad",
		value: function fakeLoad() {
			if (!this.channel.clean) {
				this.channel.clear();
			}

			if (!this.segmentation.clean) {
				this.segmentation.clear();
			}

			var channel_promise = this.fakeLoadVolume(this.channel_id, this.channel);
			var seg_promise = this.fakeLoadVolume(this.segmentation_id, this.segmentation);

			return $.when(channel_promise, seg_promise);
		}

		// used for testing correctness of pixel values loaded into data cube

	}, {
		key: "fakeLoadVolume",
		value: function fakeLoadVolume(vid, cube) {
			// 8 * 4 chunks + 4 single tiles per channel
			var _this = this;

			var specs = this.generateUrls(vid);

			var canvas = document.createElement('canvas');
			canvas.width = 2048;
			canvas.height = 2048;

			var ctx = canvas.getContext('2d');

			var max_depth = cube.size.z;

			var start = 0,
			    end = 255;
			var factor = (end - start) / max_depth;

			for (var z = 0; z < max_depth; z++) {
				var color = Math.trunc(factor * z);
				ctx.fillStyle = "rgb(" + color + ", 0, 0)";
				ctx.fillRect(0, 0, canvas.width, canvas.height);

				cube.insertCanvas(canvas, 0, 0, z);
			}

			return $.Deferred().resolve().done(function () {
				// test code
				cube.loaded = true;
			});
		}

		/* loadMovieVolume (EXPERIMENTAL)
   *
   * Used for loading the channel volume using a 
   * movie to take advantage of the time-like spatial
   * arrangement of the slices to achieve greater compression.
   *
   * Required:
   *   [0] url: The URL of the video
   *   [1] cube: The datacube to load with the images
   *
   * Return: promise representing completion
   */

	}, {
		key: "loadMovieVolume",
		value: function loadMovieVolume(url, cube) {
			// 8 * 4 chunks + 4 single tiles per channel
			var _this = this;

			var video = $('<video>')[0];
			video.src = url;
			video.width = cube.size.x;
			video.height = cube.size.y;
			video.id = 'v';

			// $('body').append(video);
			// $(video).css({
			// 	position: 'absolute',
			// 	right: "10px",
			// 	top: "10px",
			// })

			var deferred = $.Deferred();

			var canvas = document.createElement('canvas');

			var frame = 0;

			var start = performance.now();

			video.addEventListener('loadeddata', function () {
				canvas.width = video.width;
				canvas.height = video.height;

				video.currentTime = 0;
			});

			video.addEventListener('seeked', function () {
				if (frame >= cube.size.z) {
					deferred.resolve();
					console.log("Finish: " + (performance.now() - start));
					return;
				}

				captureFrame(video, frame);

				frame++;

				var sec = frame / cube.size.z * video.duration;
				video.currentTime = sec;
			});

			function captureFrame(video, z) {
				var ctx = canvas.getContext('2d');
				ctx.drawImage(video, 0, 0, video.width, video.height);
				cube.insertCanvas(canvas, 0, 0, z);
				$('#captures').text(z + 1);
			}

			return deferred;
		}

		/* loadVolume
   *
   * Download and materialize a particular Volume ID into a Datacube
   * via the XY plane / Z-axis.
   *
   * Required:
   *   [0] vid: (int) Volume ID 
   *   [1] cube: The datacube to use
   *
   * Return: promise representing loading completion
   */

	}, {
		key: "loadVolume",
		value: function loadVolume(vid, cube) {
			// 8 * 4 chunks + 4 single tiles per channel
			var _this = this;

			var specs = this.generateUrls(vid);

			var requests = [];

			specs.forEach(function (spec) {
				function decodeAndInsertImages(results) {
					var z = 0;
					results.forEach(function (result) {
						decodeBase64Image(result.data, z).done(function (imgz) {
							cube.insertImage(imgz.img, spec.x, spec.y, spec.z + imgz.z);
						});

						z++;
					});
				}

				var getreq = $.getJSON(spec.url).done(decodeAndInsertImages).fail(function (jqxhr, statusText, error) {
					// If it fails, one retry.
					if (statusText === 'abort') {
						return;
					}

					setTimeout(function () {
						var getreq2 = $.getJSON(spec.url).done(decodeAndInsertImages).fail(function () {
							console.error(spec.url + ' failed to load.');
						});

						_this.requests.push(getreq2);
					}, 1000);
				});

				requests.push(getreq);
			});

			this.requests.push.apply(this.requests, requests);

			return $.when.apply($, requests).done(function () {
				cube.loaded = true;
			});

			function decodeBase64Image(base64, z) {
				var imageBuffer = new Image();

				var deferred = $.Deferred();

				imageBuffer.onload = function () {
					deferred.resolve({
						img: this,
						z: z
					});
				};

				imageBuffer.src = base64;

				return deferred;
			}
		}

		/* generateUrls
   *
   * Generate a set of url specifications required to download a whole 
   * volume in addition to the offsets since they're downloading.
   *
   * Cubes 256x256x256 voxels and are downloaded as 128x128 chunks with
   * a user specified depth. Smaller depths require more requests.
   *
   * Required:
   *   [0] vid
   *
   * Return: [
   *    {
   *      url: self explainatory,
   *      x: offset from 0,0,0 in data cube
   *      y: offset from 0,0,0 in data cube
   *      z: offset from 0,0,0 in data cube
   *      width: horizontal dimension of image requested on XY plane
   *      height: vertical dimension of image requested on XY plane
   *      depth: bundle size, won't necessarily match height or width
   *    },
   *    ...
   * ]
   */

	}, {
		key: "generateUrls",
		value: function generateUrls(vid) {
			var _this = this;

			var specs = [];

			var CHUNK_SIZE = _this.CHUNK_SIZE,
			    BUNDLE_SIZE = _this.BUNDLE_SIZE; // results in ~130kb downloads per request

			for (var x = 0; x <= 1; x++) {
				for (var y = 0; y <= 1; y++) {
					for (var z = 0; z <= 1; z++) {
						for (var range = 0; range <= CHUNK_SIZE - BUNDLE_SIZE; range += BUNDLE_SIZE) {
							specs.push({
								url: "http://cache.eyewire.org/volume/" + vid + "/chunk/0/" + x + "/" + y + "/" + z + "/tile/xy/" + range + ":" + (range + BUNDLE_SIZE),
								x: x * CHUNK_SIZE,
								y: y * CHUNK_SIZE,
								z: z * CHUNK_SIZE + range,
								width: CHUNK_SIZE,
								height: CHUNK_SIZE,
								depth: BUNDLE_SIZE
							});
						}
					}
				}
			}

			// handle current slice later

			return specs;
		}

		/* renderChannelSlice
   *
   * Render the channel image to the given canvas context.
   * Advantage over direct data cube access is the use of a
   * background loading image.
   *
   * Required:
   *   [0] ctx
   *   [1] axis: 'x', 'y', or 'z'
   *   [2] slice: 0 - 255
   *
   * Return: segid, w/ side effect of drawing on ctx
   */

	}, {
		key: "renderChannelSlice",
		value: function renderChannelSlice(ctx, axis, slice) {
			var _this = this;

			// ctx.drawImage(_loadingimg, 0, 0);
			// ctx.drawImage(_loadingimg, 128, 0);
			// ctx.drawImage(_loadingimg, 0, 128);
			// ctx.drawImage(_loadingimg, 128, 128);

			var pixels = _this.channel.grayImageSlice(axis, slice);
			var slice32 = new Uint32Array(pixels.data.buffer); // creates a view, not an array

			var segmentation = _this.segmentation.slice(axis, slice);

			var x = undefined,
			    y = undefined,
			    segid = undefined;

			var color = [0, 0, 255];
			var alpha = 0.25;

			// exploting the fact that we know that there are
			// no black pixels in our channel images and that they're gray
			for (var i = slice32.length - 1; i >= 0; i--) {
				segid = segmentation[i];

				// 00ffff00 b/c green and blue can be swapped on big/little endian
				// but it doesn't matter like red and alpha. Just need to test for non
				// black pixels. The logical ands and ors are to avoid a branch.
				slice32[i] = slice32[i] & 0x00ffff00 && slice32[i] || 0xff0000;

				// overlayColor[i] + buffer[startIndex + i] * (1 - alpha);
				if (_this.segments[segid]) {
					pixels.data[i * 4 + 0] = Math.floor(pixels.data[i * 4 + 0] * (1 - alpha) + color[0] * alpha);
					pixels.data[i * 4 + 1] = Math.floor(pixels.data[i * 4 + 1] * (1 - alpha) + color[1] * alpha);
					pixels.data[i * 4 + 2] = Math.floor(pixels.data[i * 4 + 2] * (1 - alpha) + color[2] * alpha);
				}
			}

			ctx.putImageData(pixels, 0, 0);

			return this;
		}

		/* renderSegmentationSlice
   *
   * Convenience method for rendering a segmentation image.
   * This is mostly used for testing, and this method mainly exists
   * for consistency of API.
   *
   * Required:
   *   [0] ctx
   *   [1] axis: 'x', 'y', or 'z'
   *   [2] slice: 0 - 255
   *
   * Return: this, side effect of drawing on ctx
   */

	}, {
		key: "renderSegmentationSlice",
		value: function renderSegmentationSlice(ctx, axis, slice) {
			// Don't need to do anything special for segmentation since it's
			// not user visible. Also, in the old version, the default image was black,
			// but the cube is zeroed out by default.
			this.segmentation.renderImageSlice(ctx, axis, slice);

			return this;
		}

		/* selectSegment
   *
   * Given an axis, slice index, and normalized x and y cursor coordinates
   * ([0, 1]), 0,0 being the top left, select the segment under the mouse.
   *
   * Required:
   *   [0] axis: 'x', 'y', or 'z'
   *   [1] slice: 0 - 255
   *   [2] normx: 0...1
   *   [3] normy: 0...1
   *
   * Return: segid
   */

	}, {
		key: "selectSegment",
		value: function selectSegment(axis, slice, normx, normy) {
			var _this = this;
			var x = undefined,
			    y = undefined,
			    z = undefined;

			var sizex = _this.segmentation.size.x,
			    sizey = _this.segmentation.size.y;

			if (axis === 'x') {
				x = slice, y = normy * _this.segmentation.size.y, z = normx * _this.segmentation.size.z;
			} else if (axis === 'y') {
				x = normx * _this.segmentation.size.x, y = slice, z = normy * _this.segmentation.size.z;
			} else if (axis === 'z') {
				x = normx * _this.segmentation.size.x, y = normy * _this.segmentation.size.y, z = slice;
			}

			x = Math.round(x);
			y = Math.round(y);
			z = Math.round(z);

			var segid = _this.segmentation.get(x, y, z);

			if (segid > 0) {
				_this.segments[segid] = true;
			}

			return segid;
		}
	}]);

	return Volume;
}();

/* DataCube
 *
 * Efficiently represents a 3D image as a 1D array of integer values.
 *
 * Can be configured to use 8, 16, or 32 bit integers.
 *
 * Required:
 *  bytes: (int) 1, 2, or 4, specifies 8, 16, or 32 bit representation
 *  
 * Optional:
 *  size: { x: (int) pixels, y: (int) pixels, z: pixels}, default 256^3
 *
 * Return: self
 */

var DataCube = function () {
	function DataCube(args) {
		_classCallCheck(this, DataCube);

		this.id = args.id || null;
		this.bytes = args.bytes || 1;
		this.size = args.size || { x: 256, y: 256, z: 256 };
		this.cube = this.materialize();

		this.canvas_context = this.createImageContext();

		this.clean = true;
		this.loaded = false;
	}

	// for internal use, makes a canvas for blitting images to

	_createClass(DataCube, [{
		key: "createImageContext",
		value: function createImageContext() {
			var canvas = document.createElement('canvas');
			canvas.width = this.size.x;
			canvas.height = this.size.y;

			return canvas.getContext('2d'); // used for accelerating XY plane image insertions
		}

		// for internal use, creates the data cube of the correct data type and size

	}, {
		key: "materialize",
		value: function materialize() {
			var ArrayType = this.arrayType();

			var size = this.size;

			var cube = new ArrayType(size.x * size.y * size.z);

			// TypedArray.fill is current as of Chrome 45
			// As of this writing we're on newly released Chrome 49
			// Safari 9.0.3 also does not have it.
			return polyfill_array_fill(cube);
		}

		/* clear
   *
   * Zero out the cube and reset clean and loaded flags.
   *
   * Required: None
   *   
   * Return: this
   */

	}, {
		key: "clear",
		value: function clear() {
			this.cube.fill(0);
			this.clean = true;
			this.loaded = false;

			return this;
		}

		/* insertSquare
   *
   * Insert an XY aligned plane of data into the cube. 
   *
   * If the square extends outside the bounds of the cube, it is 
   * partially copied where it overlaps.
   *
   * Required:
   *   [0] square: A 1D array representing a 2D plane. 
   *   [1] width
   *
   * Optional:
   *   [3,4,5] x,y,z offsets into the cube for partial slice downloads  
   *
   * Return: this
   */

	}, {
		key: "insertSquare",
		value: function insertSquare(square, width) {
			var offsetx = arguments.length <= 2 || arguments[2] === undefined ? 0 : arguments[2];
			var offsety = arguments.length <= 3 || arguments[3] === undefined ? 0 : arguments[3];
			var offsetz = arguments.length <= 4 || arguments[4] === undefined ? 0 : arguments[4];

			var _this = this;

			var xsize = _this.size.x,
			    ysize = _this.size.y,
			    zsize = _this.size.z;

			offsetz *= xsize * ysize;

			for (var i = 0; i < square.length; i++) {
				var x = offsetx + i % width,
				    y = offsety + Math.floor(i / width);

				_this.cube[x + xsize * y + offsetz] = square[i];
			}

			_this.clean = false;

			return this;
		}

		/* insertCanvas
   *
   * Like insert square, but uses a canvas filled with an image instead.
   *
   * Required:
   *   [0] canvas
   *
   * Optional:
   *   [1,2,3] x,y,z offsets into the cube for partial downloads
   *
   * Return: this
   */

	}, {
		key: "insertCanvas",
		value: function insertCanvas(canvas) {
			var offsetx = arguments.length <= 1 || arguments[1] === undefined ? 0 : arguments[1];
			var offsety = arguments.length <= 2 || arguments[2] === undefined ? 0 : arguments[2];
			var offsetz = arguments.length <= 3 || arguments[3] === undefined ? 0 : arguments[3];

			var ctx = canvas.getContext('2d');
			var imgdata = ctx.getImageData(0, 0, canvas.width, canvas.height);
			return this.insertImageData(imgdata, canvas.width, offsetx, offsety, offsetz);
		}

		/* insertImage
   *
   * Like insert square, but uses an image object instead.
   *
   * Required:
   *   [0] image
   *
   * Optional:
   *   [1,2,3] x,y,z offsets into the cube for partial downloads
   *
   * Return: this
   */

	}, {
		key: "insertImage",
		value: function insertImage(img) {
			var offsetx = arguments.length <= 1 || arguments[1] === undefined ? 0 : arguments[1];
			var offsety = arguments.length <= 2 || arguments[2] === undefined ? 0 : arguments[2];
			var offsetz = arguments.length <= 3 || arguments[3] === undefined ? 0 : arguments[3];

			this.canvas_context.drawImage(img, 0, 0);
			var imgdata = this.canvas_context.getImageData(0, 0, img.width, img.height);
			return this.insertImageData(imgdata, img.width, offsetx, offsety, offsetz);
		}

		/* insertImageData
   *
   * Decodes a Uint8ClampedArray ImageData ([ R, G, B, A, .... ]) buffer
   * into interger values and inserts them into the data cube.
   *
   * Required:
   *	[0] imgdata: An ImageData object (e.g. from canvas.getImageData)
   *  [1] width: width of the image in pixels, 
   *		the height can be inferred from array length given this
   *	[2,3,4] offsets of x,y,z for partial data
   *
   * Return: this
   */

	}, {
		key: "insertImageData",
		value: function insertImageData(imgdata, width, offsetx, offsety, offsetz) {
			var _this = this;

			var pixels = imgdata.data; // Uint8ClampedArray

			// This viewing of the Uint8 as a Uint32 allows for
			// a memory stride of 4x larger, making reading and writing cheaper
			// as RAM is the slow thing here.
			var data32 = new Uint32Array(pixels.buffer); // creates a view, not an array

			// Note: on little endian machine, data32 is 0xaabbggrr, so it's already flipped
			// from the Uint8 RGBA

			var shifts = {
				1: 24,
				2: 16,
				4: 0
			};

			var shift = shifts[this.bytes];

			// This solution of shifting the bits is elegant, but individual implementations
			// for 1, 2, and 4 bytes would be more efficient.

			var x = undefined,
			    y = undefined,
			    color = undefined;

			var sizex = _this.size.x,
			    zadj = offsetz * _this.size.x * _this.size.y;

			if (this.isLittleEndian()) {
				for (var i = data32.length - 1; i >= 0; i--) {
					x = offsetx + i % width;
					y = offsety + ~ ~(i / width); // ~~ is bit twidling Math.floor using bitwise not

					// the shift operation below deletes unused higher values
					// e.g. if we're in 8 bit, we want the R value from ABGR
					// so turn it into 000R
					_this.cube[x + sizex * y + zadj] = data32[i] << shift >>> shift;
				}
			} else {
				// Untested.... don't have a big endian to test on
				for (var i = data32.length - 1; i >= 0; i--) {
					x = offsetx + i % width;
					y = offsety + ~ ~(i / width); // ~~ is bit twidling Math.floor using bitwise not

					color = data32[i] >>> shift << shift; // inverted compared to little endian

					// rgba -> abgr in byte order

					_this.cube[x + sizex * y + zadj] = color << 24 | (color & 0xff00) << 8 | (color & 0xff0000) >>> 8 | color >>> 24;
				}
			}

			_this.clean = false;

			return this;
		}

		/* get
   *
   * Retrieve a particular index from the data cube.
   *
   * Not very efficient, but useful for some purposes. It's convenient
   * to use this method rather than remember how to access the 3rd dimension
   * in a 1D array.
   *
   * Required:
   *   [0] x
   *   [1] y
   *   [2] z
   *
   * Return: value
   */

	}, {
		key: "get",
		value: function get(x, y, z) {
			return this.cube[x + this.size.x * y + this.size.x * this.size.y * z];
		}

		/* Return a 2D slice of the data cube as a 1D array 
   * of the same type.
   * 
   * x axis gets a yz plane, y gets xz, and z gets xy.
   *
   * z slicing is accelerated compared to the other two.
   *
   * Required:
   *   axis: x, y, or z
   *   index: 0 to size - 1 on that axis
   *   
   * Optional:
   *    buffer: Write to this provided buffer instead of making one
   *
   * Return: 1d array
   */

	}, {
		key: "slice",
		value: function slice(axis, index) {
			var buffer = arguments.length <= 2 || arguments[2] === undefined ? null : arguments[2];

			var _this = this;

			if (index < 0 || index >= this.size[axis]) {
				throw new Error(index + ' is out of bounds.');
			}

			var xsize = _this.size.x,
			    ysize = _this.size.y,
			    zsize = _this.size.z;

			var xysize = xsize * ysize;

			var faces = {
				x: ['y', 'z'],
				y: ['x', 'z'],
				z: ['x', 'y']
			};

			var face = faces[axis];
			var ArrayType = this.arrayType();

			var square = buffer || new ArrayType(this.size[face[0]] * this.size[face[1]]);

			// Note: order of loops is important for efficient memory access
			// and correct orientation of images. Consecutive x access is most efficient.

			var i = square.length - 1;
			if (axis === 'x') {
				for (var y = ysize - 1; y >= 0; --y) {
					for (var z = zsize - 1; z >= 0; --z) {
						square[i] = _this.cube[index + xsize * y + xysize * z];
						--i;
					}
				}
			} else if (axis === 'y') {
				// possible to make this more efficient with an array memcpy
				// as 256 x are consecutive, but no memcpy in browser.
				var yoffset = xsize * index;
				for (var z = zsize - 1; z >= 0; --z) {
					for (var x = xsize - 1; x >= 0; --x) {
						square[i] = _this.cube[x + yoffset + xysize * z];
						--i;
					}
				}
			} else if (axis === 'z') {
				var zoffset = xysize * index;
				for (var y = ysize - 1; y >= 0; --y) {
					for (var x = xsize - 1; x >= 0; --x) {
						square[i] = _this.cube[x + xsize * y + zoffset];
						--i;
					}
				}
			}

			return square;
		}

		/* imageSlice
   *
   * Generate an ImageData object that encodes a color 
   * representation of an on-axis 2D slice of the data cube.
   *
   * Required:
   *   [0] axis: 'x', 'y', or 'z'
   *   [1] index: 0 - axis size - 1
   *
   * Return: imagedata
   */

	}, {
		key: "imageSlice",
		value: function imageSlice(axis, index) {
			var _this = this;

			var square = this.slice(axis, index);

			var sizes = {
				x: [_this.size.y, _this.size.z],
				y: [_this.size.x, _this.size.z],
				z: [_this.size.x, _this.size.y]
			};

			var size = sizes[axis];

			// see https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Pixel_manipulation_with_canvas
			var imgdata = this.canvas_context.createImageData(size[0], size[1]);

			var maskset = this.getRenderMaskSet();

			var rmask = maskset.r,
			    gmask = maskset.g,
			    bmask = maskset.b,
			    amask = maskset.a;

			// if we break this for loop up by bytes, we can extract extra performance.
			// If we want to handle transparency efficiently, you'll want to break out the
			// 32 bit case so you can avoid an if statement.

			// you can also avoid doing the assignment for index 1 and 2 for 8 bit, and 2 for 16 bit
			// This code seemed more elegant to me though, so I won't prematurely optimize.

			var data = imgdata.data;

			var fixedalpha = this.bytes === 4 // no alpha channel w/ less than 4 bytes
			? 0x00000000 : 0xffffffff;

			var di = data.length - 4;
			for (var si = square.length - 1; si >= 0; si--) {
				data[di + 0] = square[si] & rmask;
				data[di + 1] = (square[si] & gmask) >>> 8;
				data[di + 2] = (square[si] & bmask) >>> 16;
				data[di + 3] = (square[si] & amask | fixedalpha) >>> 24; // can handle transparency specially if necessary

				di -= 4;
			}

			return imgdata;
		}

		/* grayImageSlice
   *
   * Generate an ImageData object that encodes a grayscale 
   * representation of an on-axis 2D slice of the data cube.
   *
   * Required:
   *   [0] axis: 'x', 'y', or 'z'
   *   [1] index: 0 - axis size - 1
   *
   * Return: imagedata
   */

	}, {
		key: "grayImageSlice",
		value: function grayImageSlice(axis, index) {
			var _this = this;

			var square = this.slice(axis, index);

			var sizes = {
				x: [_this.size.y, _this.size.z],
				y: [_this.size.x, _this.size.z],
				z: [_this.size.x, _this.size.y]
			};

			var size = sizes[axis];

			var imgdata = this.canvas_context.createImageData(size[0], size[1]);

			var maskset = this.getRenderMaskSet();

			var rmask = maskset.r;
			var data = imgdata.data;

			var di = data.length - 4;
			for (var si = square.length - 1; si >= 0; si--) {
				data[di + 0] = square[si] & rmask;
				data[di + 1] = square[si] & rmask;
				data[di + 2] = square[si] & rmask;
				data[di + 3] = 255;

				di -= 4;
			}

			return imgdata;
		}

		/* renderImageSlice
   *
   * Render a 2D slice of the data cube to a provided 
   * canvas context full vibrant color.
   *
   * Required:
   * 	[0] context
   *  [1] axis: 'x', 'y', or 'z'
   *  [2] index: 0 to axis size - 1
   *   
   * Return: this
   */

	}, {
		key: "renderImageSlice",
		value: function renderImageSlice(context, axis, index) {
			var imgdata = this.imageSlice(axis, index);
			context.putImageData(imgdata, 0, 0);
			return this;
		}

		/* renderGrayImageSlice
   *
   * Render a 2D slice of the data cube to a provided 
   * canvas context in grayscale.
   *
   * Required:
   * 	[0] context
   *  [1] axis: 'x', 'y', or 'z'
   *  [2] index: 0 to axis size - 1
   *   
   * Return: this
   */

	}, {
		key: "renderGrayImageSlice",
		value: function renderGrayImageSlice(context, axis, index) {
			var imgdata = this.grayImageSlice(axis, index);
			context.putImageData(imgdata, 0, 0);
			return this;
		}

		// http://stackoverflow.com/questions/504030/javascript-endian-encoding

	}, {
		key: "isLittleEndian",
		value: function isLittleEndian() {
			var arr32 = new Uint32Array(1);
			var arr8 = new Uint8Array(arr32.buffer);
			arr32[0] = 255;

			return arr8[0] === 255;
		}

		// For internal use, return the right bitmask for rgba image slicing
		// depending on CPU endianess.

	}, {
		key: "getRenderMaskSet",
		value: function getRenderMaskSet() {
			var bitmasks = {
				true: { // little endian, most architectures
					r: 0x000000ff,
					g: 0x0000ff00,
					b: 0x00ff0000,
					a: 0xff000000
				},
				false: { // big endian, mostly ARM and some specialized equipment
					r: 0xff000000,
					g: 0x00ff0000,
					b: 0x0000ff00,
					a: 0x000000ff
				}
			};

			return bitmasks[this.isLittleEndian()];
		}

		/* arrayType
   *
   * Return the right type of data cube array 
   * depending on the bytes argument provided.
   *
   * Required: None
   *   
   * Return: one of Uint8ClampedArray, Uint16Array, or Uint32Array
   */

	}, {
		key: "arrayType",
		value: function arrayType() {
			var choices = {
				1: Uint8ClampedArray,
				2: Uint16Array,
				4: Uint32Array
			};

			var ArrayType = choices[this.bytes];

			if (ArrayType === undefined) {
				throw new Error(this.bytes + ' is not a valid typed array byte count.');
			}

			return ArrayType;
		}
	}]);

	return DataCube;
}();

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/fill

function polyfill_array_fill(array) {
	if (array.fill) {
		return array;
	}

	array.fill = function (value) {
		// Steps 1-2.
		if (this == null) {
			throw new TypeError('this is null or not defined');
		}

		var O = Object(this);

		// Steps 3-5.
		var len = O.length >>> 0;

		// Steps 6-7.
		var start = arguments[1];
		var relativeStart = start >> 0;

		// Step 8.
		var k = relativeStart < 0 ? Math.max(len + relativeStart, 0) : Math.min(relativeStart, len);

		// Steps 9-10.
		var end = arguments[2];
		var relativeEnd = end === undefined ? len : end >> 0;

		// Step 11.
		var final = relativeEnd < 0 ? Math.max(len + relativeEnd, 0) : Math.min(relativeEnd, len);

		// Step 12.
		while (k < final) {
			O[k] = value;
			k++;
		}

		// Step 13.
		return O;
	};

	return array;
}