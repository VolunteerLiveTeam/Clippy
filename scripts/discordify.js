// Description:
//   Connects the discord rooms with the slack rooms of your choice.
// Commands:
//   hubot discordify [room-name] - will create a room/role on discord and bridge the rooms.
//   hubot view gateways - show a list of gateways by name
//   hubot view gateway <name> - show the contents of a gateway by name
//   hubot del|rem gateway <name> - remove a gateway from membory
//   hubot restart the bridge - uhh... restart the bridge...
//   hubot write the bridge - saves the config to file from the brain.
// Author:
//   @pironic & @marksomnian

const Discord = require("discord.js");
const fs = require("fs-extra");
const path = require("path");
const ejs = require("ejs");
const util = require("util");

try {

const secrets = {
    "discord" : (process.env.DISCORD_TOKEN || fs.readFileSync(process.env.DISCORD_TOKEN_FILE,'utf-8')),
    "bridge" : (process.env.DISCORD_BRIDGE_TOKEN || fs.readFileSync(process.env.DISCORD_BRIDGE_TOKEN_FILE,'utf-8')),
    "slack" : (process.env.SLACK_TOKEN || fs.readFileSync(process.env.SLACK_TOKEN_FILE,'utf-8')),
    "rancher_access" : (process.env.RANCHER_ACCESS_KEY || fs.readFileSync(process.env.RANCHER_ACCESS_KEY_FILE,'utf-8')),
    "rancher_secret" : (process.env.RANCHER_SECRET_KEY || fs.readFileSync(process.env.RANCHER_SECRET_KEY_FILE,'utf-8'))
}

const writeMatterbridgeToml = async function(robot,res) {
// naughty pironic - if you catch the error here, the rest of the script will continue as if nothing happened
//    try {
        var gateways = robot.brain.get("gateways") || [];
        const template_path = path.resolve(process.env.DISCORDIFY_TEMPLATE_FILE) || path.join(__dirname, "matterbridge.toml.ejs" );
        const toml_path = path.resolve(process.env.DISCORDIFY_TOML_FILE) || path.join(__dirname, "matterbridge.toml" );
        var template = await fs.readFile(template_path, "utf-8");
	console.log("debug: last 75 chars of template: " , util.inspect(template.slice(template.length - 75)));
	console.log("debug: gateways: " , util.inspect(gateways));
	console.log("debug: secrets: " , util.inspect(secrets));
        var matterbridgeConfig = ejs.render(template, { gateways, secrets});
console.log("debug: ejs path: "+template_path);
console.log("debug: toml path: "+toml_path);
console.log("debug: last 75 chars of toml: "+util.inspect(matterbridgeConfig.slice(matterbridgeConfig.length-75)));
        await fs.writeFile(toml_path, matterbridgeConfig)
        res.send("Config written. "+gateways.length+" gateway"+(gateways.length!=1?"s ":" ")+"saved.");

//    } catch(e) {console.log(e);}
};

const restartMatterbridge = async function(robot,res) {
//    try {
    // curl -u "${CATTLE_ACCESS_KEY}:${CATTLE_SECRET_KEY}" \
    // -X POST \
    // -H 'Accept: application/json' \
    // -H 'Content-Type: application/json' \
    // -d '{"rollingRestartStrategy":""}' \
    // 'https://rancher.writhem.com/v2-beta/projects/1a197/services/1s124/?action=restart'

    data = process.env.DISCORDIFY_RANCHER_DATA || {};
    options = { rejectUnauthorized: false }
    robot.http(process.env.DISCORDIFY_RANCHER_API_URL + "?action=restart", options)
        .header('Accept', 'application/json')
        .header('Content-Type', 'application/json')
        .auth(secrets.rancher_access, secrets.rancher_secret)
        .post(data)(function(err, resp, body) {
	    if (err) { console.error(err); throw err; }
//            console.log(err);
            console.log(body);
            body = JSON.parse(body);
            if (resp.statusCode == 200 || resp.statusCode == 202)
                res.send("Restarting the bridge, please wait just a second.")
            else
                res.send("Error: `("+resp.statusCode+") "+resp.statusMessage+"` ```"+body.substring(0, 33)+"```");
        });
//    } catch (e) { console.log(e); }
};

const waitForMatterbridge = async function (robot, res) {
	return new Promise((resolve, reject) => {
		let attempts = 0;
		const checkInterval = 2000;
		const check = () => {
			robot.http(process.env.DISCORDIFY_RANCHER_API_URL, { rejectUnauthorized: false })
				.header("Accept", "application/json")
				.header("Content-Type", "application.json")
				.auth(secrets.rancher_access, secrets.rancher_secret)
				.get()(function(err, resp, body) {
				if (err) { res.send("Error: " + err); console.error(err); reject(err); return; }
				body = JSON.parse(body);
				if (resp.statusCode === 200 || resp.statusCode === 202) {
					if (body.state === "running" || body.state === "active") {
						resolve();
					} else {
						attempts++;
						if (attempts === 10) { // random constant
							reject(new Error("too many attempts"));
						} else {
							setTimeout(check, checkInterval);
						}
					}
				} else {
					reject(new Error( resp.statusCode + " " + resp.statusMessage + " " + body.substring(0, 33) ));
				}
			});
		};
		setTimeout(check, checkInterval);
	});
};

function Gateway(slack="",discord="") {
    this.name = slack + "-" + discord;
    this.enable = true;
    this.slack = slack;
    this.discord = discord;
}

const discord = new Discord.Client({});
discord.login(secrets.discord);

const perms = Discord.Permissions.FLAGS;

module.exports = robot => {
    robot.respond(/restart the bridge/i, async res => {
        try {
            await restartMatterbridge(robot,res);
            await waitForMatterbridge(robot, res);
            res.send("Restart completed.");
        } catch (e) {
            console.log(e);
            res.send("Whoops. Error! ```" + e + "```");
        }
    });
    robot.respond(/(?:write the bridge|save gateway(?:s|))/i, async res => {
        await writeMatterbridgeToml(robot,res);
    });
    robot.respond(/(?:view|show) gateways/i, async res => {
        try {
            const gateways = robot.brain.get("gateways") || [];
            outputVar = [];
            gateways.forEach(function(gateway) {
                outputVar.push(gateway.name);
            })
            res.send("Avail Gateways: ```"+util.inspect(outputVar)+"```")
        } catch (e) {console.log(e);}
    });
    robot.respond(/(?:view|show) gateway (.*)/i, async res => {
        try {
            const gateways = robot.brain.get("gateways") || [];
            outputVar = gateways.find(function(gateway) {
                return gateway.name == res.match[1];
            });
            res.send("Gateway Details: ```"+util.inspect(outputVar)+"```")
        } catch (e) {console.log(e);}
    });
    robot.respond(/(?:delete|remove|rem|del) gateway(?:s|) (.*)/i, async res => {
        try {
            var gateways = robot.brain.get("gateways") || [];
            const index = gateways.findIndex(function(gateway) {
                return gateway.name == res.match[1];
            });
            if (index === undefined) {
                res.send("`Gateway not found.`");
            } else {
                const gateway_to_remove = gateways[index];
                console.log(index);
                gateways.splice(index, 1);
                robot.brain.set("gateways", gateways);
                res.send("Gateway ```"+util.inspect(gateway_to_remove)+"``` removed.");
            }

            await writeMatterbridgeToml(robot,res);
            await restartMatterbridge(robot,res);
	    await waitForMatterbridge(robot,res);
	    res.send("Bridge restarted successfully.");
        } catch (e) {console.log(e);}
    });

  robot.respond(/discordify\s*(?:#([a-zA-Z0-9\-]+))?$/i, async res => {
    try {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!guildId) {
      res.send(
        "DISCORD_GUILD_ID not set - please bother @marksomnian or @pironic"
      );
      return;
    }
    // get the guild object to we can use it's methods.
    const guild = discord.guilds.get(guildId);
    if (!guild) {
      res.send(
        "Misconfiguration: cannot find guild `" +
          guildId +
          "` - please bother @marksomnian or @pironic: ```"+ util.inspect(discord.guilds)+"```"
      );
      return;
    }
    // Get the desired channel name ... either provided as second arg or where it was said.
    const name = res.match[1] || res.message.rawMessage.channel.name;
    var discordChannel = guild.channels.find("name", name);
    if (!discordChannel) {
        // Create new channel
	const traineeMemberRole = guild.roles.find("name", "Trainee Member");
        const vltMemberRole = guild.roles.find("name", "VLT Members");
	const botRole = guild.roles.find("name", "Bots");
        const vltMemberPerms = [
            'VIEW_CHANNEL',
            'MANAGE_CHANNELS',
            'SEND_MESSAGES',
            'MANAGE_MESSAGES',
            'READ_MESSAGE_HISTORY'
        ];
        const channelPerms = [
            'VIEW_CHANNEL',
            'SEND_MESSAGES',
            'READ_MESSAGE_HISTORY'
        ];
        var channelRole = guild.roles.find("name", name)
        if (!channelRole) {
            // Create new role
            channelRole = await guild.createRole(
                { name: name },
                "Requested on Slack"
            );
        }
        !channelRole ? (channelRole = guild.roles.find("name", name)) : channelRole;

        discordChannel = await guild.createChannel(name, "text", [
            { id: guild.defaultRole.id, deny: vltMemberPerms },
            { id: vltMemberRole.id, allow: vltMemberPerms },
	    { id: traineeMemberRole.id, allow: vltMemberPerms },
            { id: channelRole.id, allow: channelPerms },
	    { id: botRole.id, allow: channelPerms },
        ], `Requested on Slack`);
	if (res.message.rawMessage.channel.name.indexOf("lt-") > -1) {
		try {
			const categoryChannel = guild.channels.find("name", "Live Threads");
			await discordChannel.setParent(categoryChannel.id);
		} catch (e) {
			res.send("Somebody please tell @marksomnian that his code broke: " + e);
			res.send("I'll continue as if nothing ever happened, but he really should fix this.");
		}
	}
    }
    !discordChannel ? (discordChannel = guild.channels.find("name", name)) : discordChannel;
    var gateways = robot.brain.get("gateways") || [];
    console.log(discordChannel);
    const exists = gateways.find(function(gateway) {
        return res.message.rawMessage.channel.name+"-"+discordChannel.id == gateway.name;
    });
    if (!exists) {
        gateways.push(
            new Gateway(
                res.message.rawMessage.channel.name,
                discordChannel.id
            )
        );
        robot.brain.set("gateways", gateways);
    } else {
        res.send("Error: Whoops. looks like this gateway is already set in the bridge config. We'll continue as normal just in case something died along the way");
    }

    await writeMatterbridgeToml(robot,res);
    await restartMatterbridge(robot,res);
    await waitForMatterbridge(robot, res);
    res.send("Discordified successfully! _Someone give marksomnian and pironic a medal_");
    } catch (e) {res.send("whoops. uncaught error! @pironic ```"+util.inspect(e)+"```");}
  });
};
} catch (e) {console.log(e);}

