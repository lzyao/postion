
// 定位日志操作

// 引入所需库
const mongoose = require('mongoose');
const moment = require('moment');
const _ = require('lodash');

// 引入其他方法
const baidu = require('./../baidu/controller');
const util = require('./../util/service');

// 操作接口

// 问题：记录和查询城市/省份信息时，应给每个城市/省份指定对应的ID

/**
 * 1、记录工具箱定位日志信息
 * @ param {object} [ctx] 请求体 包含 工具箱id，经度，纬度
 * @ return {object} 返回接口处理结果
 */
const recordToolBoxLog = async (ctx) => {
  try {
    const {RFID, device} = ctx.request.query;
    let {lng, lat} = ctx.request.query;
    lng = parseFloat(lng);
    lat = parseFloat(lat);
    const Device = mongoose.model('Device');
    const Task = mongoose.model('Task');
    const ToolBox = mongoose.model('ToolBox');
    const ToolBoxLogs = mongoose.model('ToolBoxLogs');
    const ToolBoxPosition = mongoose.model('ToolBoxPosition');
    let toolBoxPosition;
    let taskId;
    // 获取经纬度对应的具体位置信息
    const address = await baidu.handlePosition(lat, lng);
    const toolBox = await ToolBox.findOne({RFID: RFID});
    if (!RFID) {
      // RFID未回传， 修改 【设备状态】 为设备分离 记录日志，标记日志remark 设备分离
      await Device.update({device: device}, {
        $set: {
          status: '设备分离'
        }
      });
      // 记录对应日志
      await ToolBoxLogs.create({
        toolBox: toolBox._id,
        device: device,
        RFID: RFID,
        position: {
          lng: lng,
          lat: lat
        },
        address: address.result.formatted_address,
        remark: '设备分离',
        data: new Date(),
        province: address.result.addressComponent.province,
        city: address.result.addressComponent.city,
        district: address.result.addressComponent.district
      });
      return;
    } else {
      toolBoxPosition = await ToolBoxPosition.findOne({RFID: RFID});
      if (!toolBoxPosition) {
        // 如果第一次回传位置信息
        toolBoxPosition = await ToolBoxPosition.create({
          toolBox: toolBox._id,
          RFID: RFID,
          position: {
            lng: lng,
            lat: lat
          },
          address: address.result.formatted_address,
          date: new Date(),
          province: address.result.addressComponent.province,
          city: address.result.addressComponent.city,
          district: address.result.addressComponent.district,
          reservePosition: {
            lng: lng,
            lat: lat
          },
          reserveAddress: address.result.formatted_address,
          reserveDate: new Date()
        });
      }
      // 不为空 更新设备对应的ID
      await Device.update({device: device}, {$set: {RFID: RFID}});
      // 查询该工具箱是否有未完成任务
      const task = await Task.findOne({RFID: RFID, status: 'start'});
      if (task) {
        taskId = task._id;
        // 记录任务的位置变动流程
        let transflow = task.transflow || [];
        // 日志去重后展示-防止设备在一个位置停留时间过长导致任务流程大量重复
        // position = handleToolBoxLog(transflow, {lng: lng, lat: lat});
        transflow.push({
          position: {
            lng: lng,
            lat: lat
          },
          address: address.result.formatted_address,
          date: moment(new Date()).format('YYYY-MM-DD HH:MM:SS')
        });
        // 修改 任务流程
        await Task.update({_id: mongoose.Types.ObjectId(task._id)}, {transflow});
        // 有任务
        // 当【任务备注】为起始
        if (task.remark === '起始') {
          // 判断当前位置于起点位置距离
          const distance = parseFloat(util.getFlatternDistance({lat: lat, lng: lng}, task.startPosition));
          // 大于1000米
          if (distance > 1000) {
             // 修改 【任务备注】 为 在途
            await Task.update({_id: mongoose.Types.ObjectId(task._id)}, {remark: '在途'});
          }
        } else {
          // 当【任务备注】为在途 小于1000米,并更新任务结束 及结束时间， 更新工具预定位置
          if (task.remark === '在途') {
            // 判断当前位置距离目的地距离
            const distance = parseFloat(util.getFlatternDistance({lat: lat, lng: lng}, task.endPosition));
            // 小于1000米
            if (distance < 1000) {
              // 修改 【任务状态】 为 到达
              await Task.update({_id: mongoose.Types.ObjectId(task._id)}, {status: 'end', remark: '到达'});
              // 修改最后toolBoxPosition 预定位置
              await ToolBoxPosition.update({
                reservePosition: {
                  lng: lng,
                  lat: lat
                },
                reserveAddress: address.result.formatted_address,
                reserveDate: new Date()
              });
            }
          }
        }
      } else {
        // 无任务
        // 判断当前位与预定位置 大于1000米 修改 【工具状态】 为异常   --- 三天内离开医院后在回来也会是异常状态
        const distance = parseFloat(util.getFlatternDistance({lat: lat, lng: lng}, toolBoxPosition.reservePosition));
        if (distance > 1000) {
          await ToolBox.update({_id: mongoose.Types.ObjectId(toolBox._id)}, {$set: {status: '异常', remark: '离预定位置距离大于1000米'}});
        }
        // 判断工具状态
        if (toolBox.statsu === '占用') {
          // 判断工具预定时间于当前时间对比是否大于三天
          // 计算两个时间差
          var a = moment(toolBoxPosition.reserveDate);
          var b = moment(new Date());
          const day = b.diff(a, 'days');
          if (day > 3) {
            // 大于三天 修改工具状态为可调配状态
            await ToolBox.update({_id: mongoose.Types.ObjectId(toolBox._id)}, {$set: {status: '可调配'}});
          }
        }
      }
    }
    // 记录当前定位信息到日志表（toolBoxLogs)
      // 记录对应日志
    await ToolBoxLogs.create({
      toolBox: toolBox._id,
      device: device,
      RFID: RFID,
      task: taskId,
      position: {
        lng: lng,
        lat: lat
      },
      address: address.result.formatted_address,
      remark: '正常',
      data: new Date(),
      province: address.result.addressComponent.province,
      city: address.result.addressComponent.city,
      district: address.result.addressComponent.district
    });
    // 更新当前位置信息到设备位置表(toolBoxPosition)
    await ToolBoxPosition.update({_id: mongoose.Types.ObjectId(toolBoxPosition._id)}, {
      $set: {
        position: {
          lng: lng,
          lat: lat
        },
        date: new Date(),
        address: address.result.formatted_address,
        province: address.result.addressComponent.province,
        city: address.result.addressComponent.city,
        district: address.result.addressComponent.district
      }
    });
    ctx.body = util.returnBody('ok', '记录成功');
  } catch (err) {
    console.log(err);
    ctx.body = util.returnBody('ok', '服务器异常');
  }
};

// 2、查询各省份或者各城市/区工具箱数量
const findToolBoxByProvince = async (ctx) => {
  try {
    const ToolBoxPosition = mongoose.model('ToolBoxPosition');
    const countToolBox = await ToolBoxPosition.aggregate([
      {$group: {_id: '$province', count: {$sum: 1}}},
      {$project: {
        province: '$_id',
        count: '$count'
      }}
    ]);
    ctx.body = util.returnBody('ok', '查询成功', countToolBox);
  } catch (err) {
    console.log(err);
    ctx.body = {success: 'error', status: 1001, message: '服务器异常'};
  }
};

// 3、查询各城市/区工具箱数量
const findToolBoxByCity = async (ctx) => {
  try {
    const ToolBoxPosition = mongoose.model('ToolBoxPosition');
    const {province} = ctx.request.query;
    const countToolBox = await ToolBoxPosition.aggregate([
      {$match: {province}},
      {$group: {_id: '$city', count: {$sum: 1}}},
      {$project: {
        city: '$_id',
        count: '$count'
      }}
    ]);
    ctx.body = util.returnBody('ok', '查询成功', countToolBox);
  } catch (err) {
    console.log(err);
    ctx.body = util.returnBody('err', '查询成功');
  }
};

// 4、查询工具箱列表
const findToolBoxList = async (ctx) => {
  try {
    const {city, address, RFID, status} = ctx.request.query;
    const ToolBox = mongoose.model('ToolBox');
    const ToolBoxPosition = mongoose.model('ToolBoxPosition');
    let where = {};
    if (city) _.merge(where, {city});
    if (address) _.merge(where, {address});
    if (RFID) _.merge(where, {RFID});
    if (status) {
      let toolBox = await ToolBox.find({status}).select('_id');
      toolBox = _.map(toolBox, '_id');
      _.merge(where, {toolBox: {$in: toolBox}});
    }
    const toolBoxs = await ToolBoxPosition.find(where).select(['RFID', 'position', 'date', 'address']);
    ctx.body = util.returnBody('ok', '查询成功', toolBoxs);
  } catch (err) {
    console.log(err);
    ctx.body = util.returnBody('err', '查询失败');
  }
};

// 5、查询单个工具箱状态和位置
const findOneToolBox = async (ctx) => {
  try {
    const {RFID} = ctx.request.query;
    const ToolBox = mongoose.model('ToolBox');
    const ToolBoxLog = mongoose.model('ToolBoxLogs');
    const Task = mongoose.model('Task');
    const Device = mongoose.model('Device');
    let result = {};
    // 查询任务
    let task = await Task.findOne({RFID, status: 'start'}).select(['endAddress', 'endPosition', 'remark', 'transflow']) || {};
    if (!task.transflow || !task.transflow.length) {
    // 如果有任务存在，则查询该任务的位置变化
    // toolBoxLog = await ToolBoxLog.find({RFID, task: mongoose.Types.ObjectId(task._id)}).select(['position', 'address', 'date']);
      task.transflow = [];
      task.transflow.push(await ToolBoxLog.findOne({RFID}).sort({createdAt: -1}).select(['position', 'address', 'date']));
    }
    // 查询工具箱信息
    const toolBox = await ToolBox.findOne({RFID});
    // 查询设备ID
    const device = await Device.findOne({RFID});
    // 拼接返回结果
    if (toolBox) _.merge(result, {toolBox});
    if (task) _.merge(result, {task});
    if (device) _.merge(result, {device});
    ctx.body = util.returnBody('ok', '查询成功', result);
  } catch (err) {
    console.log(err);
    ctx.body = util.returnBody('err', '查询失败');
  }
};

// 6、根据状态统计不同精确度的地图信息
const countToolBoxByStatus = async (ctx) => {
  try {
    const {province, city} = ctx.request.query;
    const ToolBoxPosition = mongoose.model('ToolBoxPosition');
    let where = {};
    if (province) _.merge(where, {province});
    if (city) _.merge(where, {city});
    // 查询当前条件下所有设备位置信息
    let toolBox = await ToolBoxPosition
    .find(where).populate([{
      path: 'toolBox',
      select: ['status']
    }]).select(['province', 'city']);
    // 根据设备进行分组
    toolBox = _.groupBy(toolBox, 'toolBox.status');
    let countToolBox = [];
    countToolBox.push({status: '异常', count: (toolBox.异常 && toolBox.异常.length) || 0});
    countToolBox.push({status: '占用', count: (toolBox.占用 && toolBox.占用.length) || 0});
    countToolBox.push({status: '可调配', count: (toolBox.可调配 && toolBox.可调配.length) || 0});
    ctx.body = util.returnBody('ok', '查询成功', countToolBox);
  } catch (err) {
    console.log(err);
    ctx.body = util.returnBody('err', '查询失败');
  }
};

// 通用辅助方法

// 处理日志重复位置问题
const handleToolBoxLog = async (toolBoxLog) => {
  // 两个位置小于20米则认为位置没变
};

module.exports.register = ({router}) => {
  // 1、记录设备回传日志
  router.get('/record/toolbox', recordToolBoxLog);
  // 2、统计各个省份对应的设备数量
  router.get('/count/province', findToolBoxByProvince);
  // 3、统计各个城市对应的设备数量
  router.get('/count/city', findToolBoxByCity);
  // 4、查询设备列表
  router.get('/find/toolBox/list', findToolBoxList);
  // 5、查询单个设备的信息
  router.get('/find/toolBox/one', findOneToolBox);
  // 6、统计各个状态对应的数量
  router.get('/count/status', countToolBoxByStatus);
};